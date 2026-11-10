import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { PAYMENT_METHODS, dateSchema, gramsSchema, optionalText } from '../../utils/validation.js';
import { assertDayOpen } from '../../utils/dayLock.js';
import { writeAudit } from '../../utils/audit.js';
import { cancelReason, grams, money as fmtMoney, runCancel, sendCancel } from '../../utils/cancelEffects.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { goldHeldOfKarat } from '../craftsmen/craftsmen.gold.js';

// Customer repairs: the customer's own item comes in, goes to a craftsman, comes back and is handed over.
//   received -> with_craftsman -> ready -> delivered   (cancelled before it is back)
// The item is never shop stock. Shop gold added to it goes through the craftsman's gold ledger:
//   give: issue +extra (and held_used -held when his own gold is used)
//   back: return -(extra - wastage), wastage -wastage   (wastage = shortfall, at most the extra gold)
// Money is ordinary customer receipts with repair_id; a delivered repair is owed like a bill.

const router = Router();

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const money = (label) => z.coerce.number({ error: `Enter the ${label}` }).min(0, 'Cannot be negative').max(1e10).default(0);
const optionalDate = dateSchema.optional().nullable().or(z.literal('').transform(() => null));

const paymentFields = {
  amount: money('amount'),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  reference_no: optionalText(50),
  cheque_date: optionalDate,
};

const receiveSchema = z.object({
  customer_id: z.coerce.number({ error: 'Choose a customer' }).int().positive('Choose a customer'),
  received_date: dateSchema,
  item_description: z.string({ error: 'Describe the item' }).trim().min(1, 'Describe the item').max(255),
  karat_id: z.coerce.number().int().positive().optional().nullable(),
  weight_in_g: gramsSchema('weight').refine((v) => v > 0, 'Weight must be above 0'),
  work_to_do: optionalText(255),
  promised_date: optionalDate,
  estimated_charge: money('estimated charge'),
  notes: optionalText(255),
  advance: z.object(paymentFields).optional().nullable(),
});

const editSchema = z.object({
  item_description: z.string().trim().min(1, 'Describe the item').max(255),
  karat_id: z.coerce.number().int().positive().optional().nullable(),
  weight_in_g: gramsSchema('weight').refine((v) => v > 0, 'Weight must be above 0'),
  work_to_do: optionalText(255),
  promised_date: optionalDate,
  estimated_charge: money('estimated charge'),
  notes: optionalText(255),
});

const giveSchema = z.object({
  craftsman_id: z.coerce.number({ error: 'Choose a craftsman' }).int().positive('Choose a craftsman'),
  given_date: dateSchema,
  craftsman_fee: money('craftsman fee'),
  karat_id: z.coerce.number().int().positive().optional().nullable(),
  extra_gold_g: gramsSchema('extra gold').refine((v) => v >= 0, 'Cannot be negative').default(0),
  use_held_gold: z.boolean().default(true),
});

const backSchema = z.object({
  back_date: dateSchema,
  weight_back_g: gramsSchema('weight').refine((v) => v > 0, 'Weight must be above 0'),
  craftsman_fee: money('craftsman fee'),
});

const deliverSchema = z.object({
  delivered_date: dateSchema,
  weight_out_g: gramsSchema('weight').refine((v) => v > 0, 'Weight must be above 0'),
  repair_charge: money('repair charge'),
  gold_charge: money('gold charge'),
  payment: z.object(paymentFields).optional().nullable(),
});

const paySchema = z.object({ payment_date: dateSchema, ...paymentFields, notes: optionalText(255) });

const listSchema = z.object({
  status: z.enum(['open', 'received', 'with_craftsman', 'ready', 'delivered', 'cancelled', 'all']).default('open'),
  customer_id: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(50).default(''),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const PAID_SQL = `COALESCE((SELECT SUM(p.amount) FROM customer_payments p WHERE p.repair_id = r.id AND p.status = 'active'), 0)`;

const REPAIR_SELECT = `
  SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, k.name AS karat_name, cm.name AS craftsman_name,
         u.name AS created_by_name, ${PAID_SQL} AS paid_amount
  FROM repair_orders r
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN karats k ON k.id = r.karat_id
  LEFT JOIN craftsmen cm ON cm.id = r.craftsman_id
  JOIN users u ON u.id = r.created_by`;

function toRepair(row) {
  const paid = round2(Number(row.paid_amount));
  // Before collection the customer owes nothing yet; what they paid is an advance on this repair.
  const due = row.status === 'delivered' ? round2(Number(row.total_charge) - paid) : 0;
  return { ...row, paid_amount: paid, balance_due: due };
}

async function findRepair(db, id, lock = false) {
  const [rows] = await db.query(`${REPAIR_SELECT} WHERE r.id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw new HttpError(404, 'Repair not found');
  return toRepair(rows[0]);
}

async function findRepairFull(db, id) {
  const repair = await findRepair(db, id);
  const [payments] = await db.query(
    `SELECT id, receipt_no, payment_date, amount, method, reference_no, status, notes
     FROM customer_payments WHERE repair_id = ? ORDER BY payment_date, id`,
    [id],
  );
  return { ...repair, payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })) };
}

async function addReceipt(conn, req, repair, date, pay, note) {
  if (!pay || !(pay.amount > 0)) return null;
  await assertDayOpen(conn, date);
  const receiptNo = await nextDocumentNumber(conn, 'RCP');
  const [result] = await conn.query(
    `INSERT INTO customer_payments (receipt_no, customer_id, repair_id, payment_date, amount, method, reference_no, cheque_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [receiptNo, repair.customer_id, repair.id, date, pay.amount, pay.method, pay.reference_no ?? null, pay.cheque_date ?? null,
      pay.notes || `${note} ${repair.repair_no}`, req.user.id],
  );
  await writeAudit(conn, req, { action: 'create', table: 'customer_payments', recordId: result.insertId, newValues: { ...pay, receipt_no: receiptNo, repair_id: repair.id } });
  return receiptNo;
}

async function goldLedger(conn, req, repair, type, weight, date, notes) {
  if (!weight) return;
  await conn.query(
    `INSERT INTO craftsman_gold_ledger (craftsman_id, repair_id, karat_id, txn_date, txn_type, weight_g, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [repair.craftsman_id, repair.id, repair.karat_id, date, type, round3(weight), notes, req.user.id],
  );
}

async function checkKarat(conn, karatId) {
  if (!karatId) return;
  const [[k]] = await conn.query('SELECT id FROM karats WHERE id = ?', [karatId]);
  if (!k) throw new HttpError(400, 'Choose a karat');
}

router.get('/', requirePermission('repairs.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.status === 'open') where.push("r.status IN ('received', 'with_craftsman', 'ready')");
  else if (q.status !== 'all') { where.push('r.status = ?'); params.push(q.status); }
  if (q.customer_id) { where.push('r.customer_id = ?'); params.push(q.customer_id); }
  if (q.search) {
    where.push('(r.repair_no LIKE ? OR r.item_description LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    params.push(...Array(4).fill(`%${q.search}%`));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM repair_orders r JOIN customers c ON c.id = r.customer_id ${whereSql}`, params);
  const [counts] = await pool.query('SELECT status, COUNT(*) AS n FROM repair_orders GROUP BY status');
  const [rows] = await pool.query(
    `${REPAIR_SELECT} ${whereSql} ORDER BY FIELD(r.status, 'ready', 'with_craftsman', 'received', 'delivered', 'cancelled'), r.received_date DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...params, q.page_size, q.page * q.page_size],
  );
  res.json({ total, counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])), repairs: rows.map(toRepair) });
});

router.get('/:id', requirePermission('repairs.view'), async (req, res) => {
  res.json(await findRepairFull(pool, parseId(req.params.id)));
});

// Take in the customer's item, with an optional advance.
router.post('/', requirePermission('repairs.create'), async (req, res) => {
  const data = receiveSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    await assertDayOpen(conn, data.received_date);
    const [[customer]] = await conn.query('SELECT id FROM customers WHERE id = ?', [data.customer_id]);
    if (!customer) throw new HttpError(400, 'Customer not found');
    await checkKarat(conn, data.karat_id);
    if (data.promised_date && data.promised_date < data.received_date) throw new HttpError(400, 'Promised date is before the date received');
    const repairNo = await nextDocumentNumber(conn, 'REP');
    const [result] = await conn.query(
      `INSERT INTO repair_orders (repair_no, customer_id, received_date, item_description, karat_id, weight_in_g, work_to_do,
                                  promised_date, estimated_charge, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
      [repairNo, data.customer_id, data.received_date, data.item_description, data.karat_id ?? null, data.weight_in_g,
        data.work_to_do, data.promised_date ?? null, data.estimated_charge, data.notes, req.user.id],
    );
    const repair = { id: result.insertId, repair_no: repairNo, customer_id: data.customer_id };
    await addReceipt(conn, req, repair, data.received_date, data.advance, 'Advance for repair');
    await writeAudit(conn, req, { action: 'create', table: 'repair_orders', recordId: repair.id, newValues: { ...data, repair_no: repairNo } });
    return repair.id;
  });
  res.status(201).json(await findRepairFull(pool, id));
});

// Change the details while it is still in the shop or with the craftsman.
router.put('/:id', requirePermission('repairs.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = editSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findRepair(conn, id, true);
    if (!['received', 'with_craftsman'].includes(before.status)) throw new HttpError(400, 'Only repairs not yet back can be changed');
    await checkKarat(conn, data.karat_id);
    // Once shop gold is with the craftsman, the karat and weight in are fixed.
    const locked = before.status !== 'received';
    if (locked && Number(before.extra_gold_g) > 0 && (data.karat_id ?? null) !== before.karat_id) {
      throw new HttpError(400, 'The karat cannot change after shop gold was given');
    }
    await conn.query(
      `UPDATE repair_orders SET item_description = ?, karat_id = ?, weight_in_g = ?, work_to_do = ?, promised_date = ?,
                                estimated_charge = ?, notes = ? WHERE id = ?`,
      [data.item_description, data.karat_id ?? null, locked ? before.weight_in_g : data.weight_in_g, data.work_to_do,
        data.promised_date ?? null, data.estimated_charge, data.notes, id],
    );
    await writeAudit(conn, req, { action: 'update', table: 'repair_orders', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findRepairFull(pool, id));
});

// Give the item to a craftsman, with any shop gold to add.
router.post('/:id/give', requirePermission('repairs.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = giveSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const repair = await findRepair(conn, id, true);
    if (repair.status !== 'received') throw new HttpError(400, `${repair.repair_no} is already ${repair.status.replace('_', ' ')}`);
    await assertDayOpen(conn, data.given_date);
    if (data.given_date < String(repair.received_date).slice(0, 10)) throw new HttpError(400, 'Date given is before the date received');
    const [[craftsman]] = await conn.query('SELECT is_active FROM craftsmen WHERE id = ? FOR UPDATE', [data.craftsman_id]);
    if (!craftsman?.is_active) throw new HttpError(400, 'Choose an active craftsman');

    const karatId = data.karat_id ?? repair.karat_id;
    if (data.extra_gold_g > 0 && !karatId) throw new HttpError(400, 'Choose the karat of the gold added');
    await checkKarat(conn, karatId);
    const has = data.extra_gold_g > 0 && data.use_held_gold
      ? Math.max(0, await goldHeldOfKarat(conn, data.craftsman_id, karatId)) : 0;
    const held = round3(Math.min(has, data.extra_gold_g));

    await conn.query(
      `UPDATE repair_orders SET craftsman_id = ?, given_date = ?, craftsman_fee = ?, karat_id = ?, extra_gold_g = ?, held_gold_g = ?,
                                status = 'with_craftsman' WHERE id = ?`,
      [data.craftsman_id, data.given_date, data.craftsman_fee, karatId ?? null, data.extra_gold_g, held, id],
    );
    const updated = { ...repair, craftsman_id: data.craftsman_id, karat_id: karatId };
    await goldLedger(conn, req, updated, 'issue', data.extra_gold_g, data.given_date, `Gold added for repair ${repair.repair_no}`);
    await goldLedger(conn, req, updated, 'held_used', -held, data.given_date, 'Gold he already had');
    await writeAudit(conn, req, { action: 'give', table: 'repair_orders', recordId: id, newValues: { ...data, held_gold_g: held } });
  });
  res.json(await findRepairFull(pool, id));
});

// The craftsman brings it back. Any shortfall against weight in + shop gold is wastage of the shop gold first.
router.post('/:id/back', requirePermission('repairs.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = backSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const repair = await findRepair(conn, id, true);
    if (repair.status !== 'with_craftsman') throw new HttpError(400, `${repair.repair_no} is not with a craftsman`);
    await assertDayOpen(conn, data.back_date);
    if (data.back_date < String(repair.given_date).slice(0, 10)) throw new HttpError(400, 'Date back is before the date given');
    const extra = Number(repair.extra_gold_g);
    const expected = round3(Number(repair.weight_in_g) + extra);
    const short = Math.max(0, round3(expected - data.weight_back_g));
    const wastage = round3(Math.min(short, extra));
    await conn.query(
      "UPDATE repair_orders SET back_date = ?, weight_back_g = ?, craftsman_fee = ?, status = 'ready' WHERE id = ?",
      [data.back_date, data.weight_back_g, data.craftsman_fee, id],
    );
    await goldLedger(conn, req, repair, 'return', -(extra - wastage), data.back_date, `Gold in repaired piece ${repair.repair_no}`);
    await goldLedger(conn, req, repair, 'wastage', -wastage, data.back_date, `Repair ${repair.repair_no}`);
    await writeAudit(conn, req, { action: 'back', table: 'repair_orders', recordId: id, newValues: { ...data, wastage_g: wastage } });
  });
  res.json(await findRepairFull(pool, id));
});

// Hand the item back to the customer and take the money; whatever is not paid stays on their account.
router.post('/:id/deliver', requirePermission('repairs.deliver'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = deliverSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const repair = await findRepair(conn, id, true);
    if (repair.status !== 'ready') throw new HttpError(400, `${repair.repair_no} is not back from the craftsman yet`);
    await assertDayOpen(conn, data.delivered_date);
    if (data.delivered_date < String(repair.back_date).slice(0, 10)) throw new HttpError(400, 'Date collected is before the date it came back');
    const total = round2(data.repair_charge + data.gold_charge);
    const due = round2(total - repair.paid_amount);
    if (data.payment?.amount > due + 0.005) {
      throw new HttpError(400, `Only ${Math.max(0, due).toFixed(2)} is left to pay`);
    }
    await conn.query(
      `UPDATE repair_orders SET delivered_date = ?, weight_out_g = ?, repair_charge = ?, gold_charge = ?, total_charge = ?,
                                status = 'delivered' WHERE id = ?`,
      [data.delivered_date, data.weight_out_g, data.repair_charge, data.gold_charge, total, id],
    );
    await addReceipt(conn, req, repair, data.delivered_date, data.payment, 'Payment for repair');
    await writeAudit(conn, req, { action: 'deliver', table: 'repair_orders', recordId: id, newValues: { ...data, total_charge: total } });
  });
  res.json(await findRepairFull(pool, id));
});

// Money for a collected repair that was left on credit.
router.post('/:id/payments', requirePermission('repairs.deliver'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = paySchema.parse(req.body);
  if (!(data.amount > 0)) throw new HttpError(400, 'Amount must be above 0');
  await withTransaction(async (conn) => {
    const repair = await findRepair(conn, id, true);
    if (repair.status !== 'delivered') throw new HttpError(400, 'Take the money when the item is collected');
    if (data.amount > repair.balance_due + 0.005) throw new HttpError(400, `Only ${Math.max(0, repair.balance_due).toFixed(2)} is left to pay`);
    await addReceipt(conn, req, repair, data.payment_date, data, 'Payment for repair');
  });
  res.status(201).json(await findRepairFull(pool, id));
});

// Called off before it is back: the customer takes the item back. Shop gold with the craftsman comes back.
// Advances stay with the shop as the customer's money; cancel the receipt to refund it.
router.post('/:id/cancel', requirePermission('repairs.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = cancelReason(req);
  const outcome = await runCancel(req, { table: 'repair_orders', recordId: id }, async (conn, fx) => {
    const repair = await findRepair(conn, id, true);
    if (!['received', 'with_craftsman'].includes(repair.status)) {
      throw new HttpError(400, repair.status === 'ready' ? 'It is already repaired; hand it over instead' : `${repair.repair_no} is already ${repair.status}`);
    }
    const [[{ today }]] = await conn.query('SELECT CURDATE() AS today');
    await assertDayOpen(conn, today);
    await fx.watchCustomer(conn, repair.customer_id);
    if (repair.status === 'with_craftsman') {
      await fx.watchCraftsman(conn, repair.craftsman_id);
      fx.add('craftsman', `Get the item back from ${repair.craftsman_name}${Number(repair.extra_gold_g) > 0 ? `, with the ${grams(repair.extra_gold_g)} of shop gold given for it` : ''}`, '/craftsmen');
      const extra = Number(repair.extra_gold_g);
      await goldLedger(conn, req, repair, 'gold_returned', -extra, today, `Repair ${repair.repair_no} cancelled`);
      await goldLedger(conn, req, repair, 'held_used', Number(repair.held_gold_g), today, 'Repair cancelled: held gold back on balance');
    }
    fx.add('gold', `Give ${repair.customer_name} their item back (${repair.item_description}, ${grams(repair.weight_in_g)} when taken in)`);
    if (repair.paid_amount > 0) {
      fx.add('receipt', `${fmtMoney(repair.paid_amount)} paid for this repair stays as the customer's advance. To give it back, cancel the receipt in Receipts.`, '/customer-payments');
    }
    await conn.query("UPDATE repair_orders SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason, id]);
    await writeAudit(conn, req, { action: 'cancel', table: 'repair_orders', recordId: id, newValues: { reason } });
  });
  await sendCancel(res, outcome, () => findRepairFull(pool, id));
});

export default router;
