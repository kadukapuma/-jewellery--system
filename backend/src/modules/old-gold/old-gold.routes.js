import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { dateSchema, optionalText } from '../../utils/validation.js';
import { dbToday } from '../../utils/dayLock.js';
import { cancelledRecordRoutes } from '../../utils/cancelledRecords.js';
import { snapshot } from '../../utils/recycleBin.js';
import { cancelReason, runCancel, sendCancel } from '../../utils/cancelEffects.js';
import { allocateCustomerPayment, recomputeSale } from '../customer-payments/customer-payments.service.js';
import { getCurrentPrices } from '../gold-prices/gold-prices.service.js';
import {
  cancelOldGoldReceipt, createOldGoldReceipt, getDeductionPercent, oldGoldLinesSchema, oldGoldNotes, priceOldGoldLines,
} from './old-gold.service.js';
import { BANK_JOIN_SQL, BANK_LABEL_SQL, bankAccountIdField } from '../../utils/bankAccount.js';

// Old gold taken from customers: bought for cash, or kept as credit on the customer's account.
// Exchange on a new bill is saved with the bill (POST /api/sales with `old_gold`).

const router = Router();

const createSchema = z
  .object({
    receipt_date: dateSchema.optional(),
    customer_id: z.coerce.number().int().positive().optional().nullable(),
    mode: z.enum(['cash', 'credit'], { error: 'Choose cash or credit' }),
    payout_method: z.enum(['cash', 'bank_transfer']).default('cash'),
    payout_reference: optionalText(50),
    bank_account_id: bankAccountIdField,
    lines: oldGoldLinesSchema,
    notes: oldGoldNotes,
  })
  .refine((d) => d.mode !== 'credit' || d.customer_id, { path: ['customer_id'], message: 'Choose the customer to give the credit to' });

const listSchema = z.object({
  status: z.enum(['active', 'cancelled', 'all']).default('active'),
  mode: z.enum(['cash', 'credit', 'exchange', 'all']).default('all'),
  customer_id: z.coerce.number().int().positive().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  search: z.string().trim().max(50).default(''),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const RECEIPT_SELECT = `
  SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.nic AS customer_nic,
         s.invoice_no, u.name AS created_by_name, ${BANK_LABEL_SQL()} AS bank_account_label,
         (SELECT COUNT(*) FROM old_gold_lines l WHERE l.receipt_id = r.id) AS pieces,
         -- How much of the credit / exchange value has gone onto bills, and which bills.
         (SELECT COALESCE(SUM(a.amount), 0) FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id
          WHERE p.old_gold_id = r.id AND p.status = 'active') AS used_amount,
         (SELECT GROUP_CONCAT(DISTINCT us.invoice_no ORDER BY us.id SEPARATOR ', ')
          FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id JOIN sales us ON us.id = a.sale_id
          WHERE p.old_gold_id = r.id AND p.status = 'active') AS used_on
  FROM old_gold_receipts r
  LEFT JOIN customers c ON c.id = r.customer_id
  LEFT JOIN sales s ON s.id = r.sale_id
  JOIN users u ON u.id = r.created_by
  ${BANK_JOIN_SQL('r')}`;

// usage: cash = paid out; otherwise how much of the value went onto bills.
//   unused (all still an advance) | partly_used | used
function num(row) {
  const value = Number(row.total_value);
  const used = Math.round(Number(row.used_amount ?? 0) * 100) / 100;
  let usage = null;
  if (row.mode === 'cash') usage = 'paid_out';
  else if (row.status === 'active') usage = used >= value - 0.009 ? 'used' : used > 0 ? 'partly_used' : 'unused';
  return {
    ...row,
    total_value: value,
    total_net_weight_g: Number(row.total_net_weight_g),
    pieces: Number(row.pieces ?? 0),
    used_amount: used,
    available_amount: row.mode === 'cash' || row.status !== 'active' ? 0 : Math.round((value - used) * 100) / 100,
    used_on: row.used_on || null,
    usage,
  };
}

export async function findOldGold(db, id, lock = false) {
  const [[row]] = await db.query(`${RECEIPT_SELECT} WHERE r.id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) throw new HttpError(404, 'Old gold receipt not found');
  const [lines] = await db.query(
    `SELECT l.*, k.name AS karat_name, cat.name AS category_name, i.item_code, i.barcode, i.status AS item_status
     FROM old_gold_lines l JOIN karats k ON k.id = l.karat_id JOIN categories cat ON cat.id = l.category_id
     LEFT JOIN items i ON i.id = l.item_id
     WHERE l.receipt_id = ? ORDER BY l.id`,
    [id],
  );
  const [payments] = await db.query(
    `SELECT p.id, p.receipt_no, p.amount, p.status,
            COALESCE((SELECT SUM(a.amount) FROM customer_payment_allocations a WHERE a.payment_id = p.id), 0) AS allocated
     FROM customer_payments p WHERE p.old_gold_id = ?`,
    [id],
  );
  return {
    ...num(row),
    lines: lines.map((l) => ({
      ...l,
      gross_weight_g: Number(l.gross_weight_g), stone_weight_g: Number(l.stone_weight_g), net_weight_g: Number(l.net_weight_g),
      gram_rate: Number(l.gram_rate), deduction_percent: Number(l.deduction_percent), calc_value: Number(l.calc_value), value: Number(l.value),
    })),
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount), allocated: Number(p.allocated) })),
  };
}

router.get('/', requirePermission('old_gold.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.status !== 'all') { where.push('r.status = ?'); params.push(q.status); }
  if (q.mode !== 'all') { where.push('r.mode = ?'); params.push(q.mode); }
  if (q.customer_id) { where.push('r.customer_id = ?'); params.push(q.customer_id); }
  if (q.from) { where.push('r.receipt_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('r.receipt_date <= ?'); params.push(q.to); }
  if (q.search) {
    where.push('(r.receipt_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR s.invoice_no LIKE ?)');
    params.push(...Array(4).fill(`%${q.search}%`));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM old_gold_receipts r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN sales s ON s.id = r.sale_id';
  const [[sums]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(r.total_value), 0) AS value, COALESCE(SUM(r.total_net_weight_g), 0) AS weight ${from} ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(
    `${RECEIPT_SELECT} ${whereSql} ORDER BY r.receipt_date DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...params, q.page_size, q.page * q.page_size],
  );
  res.json({
    total: Number(sums.total),
    sums: { value: Number(sums.value), weight_g: Number(sums.weight) },
    receipts: rows.map(num),
  });
});

// Live value of the pieces at today's price, for the screen. Nothing is saved.
router.post('/quote', requirePermission('old_gold.create', 'sales.create'), async (req, res) => {
  const lines = oldGoldLinesSchema.parse(req.body?.lines);
  res.json(await priceOldGoldLines(pool, lines));
});

// What the old gold form needs: the deduction %, karats with today's gram price, and categories.
router.get('/settings', requirePermission('old_gold.view', 'old_gold.create', 'sales.create'), async (req, res) => {
  const prices = await getCurrentPrices(pool);
  const [categories] = await pool.query('SELECT id, name, category_type FROM categories WHERE is_active = 1 ORDER BY name');
  res.json({
    deduction_percent: await getDeductionPercent(pool),
    karats: prices.map((p) => ({ id: p.karat_id, name: p.karat, gram_price: p.gram_price === null ? null : Number(p.gram_price), is_today: p.is_today })),
    categories,
  });
});

router.get('/:id', requirePermission('old_gold.view', 'sales.view'), async (req, res) => {
  res.json(await findOldGold(pool, parseId(req.params.id)));
});

// Buy for cash, or keep as credit (it pays the customer's open bills first; the rest is an advance).
router.post('/', requirePermission('old_gold.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const today = await dbToday(conn);
    const date = data.receipt_date ?? today;
    if (date > today) throw new HttpError(400, 'The date cannot be in the future');
    if (data.customer_id) {
      const [[c]] = await conn.query('SELECT id FROM customers WHERE id = ?', [data.customer_id]);
      if (!c) throw new HttpError(400, 'Customer not found');
    }
    const receipt = await createOldGoldReceipt(conn, req, {
      date,
      customerId: data.customer_id ?? null,
      mode: data.mode,
      payoutMethod: data.payout_method,
      payoutReference: data.payout_reference,
      payoutBankAccountId: data.bank_account_id,
      lines: data.lines,
      notes: data.notes,
    });
    if (receipt.payment_id) {
      await allocateCustomerPayment(conn, { paymentId: receipt.payment_id, customerId: data.customer_id, amount: receipt.total_value });
    }
    return receipt.id;
  });
  res.status(201).json(await findOldGold(pool, id));
});

router.post('/:id/cancel', requirePermission('old_gold.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = cancelReason(req, { required: true });
  const outcome = await runCancel(req, { table: 'old_gold_receipts', recordId: id }, async (conn, fx) => {
    const receipt = await findOldGold(conn, id, true);
    if (receipt.mode === 'exchange' && receipt.sale_id) {
      const [[sale]] = await conn.query('SELECT status, invoice_no FROM sales WHERE id = ?', [receipt.sale_id]);
      if (sale?.status === 'completed') {
        throw new HttpError(400, `This gold was exchanged on bill ${sale.invoice_no}. Cancel the bill first.`);
      }
    }
    const saleIds = await cancelOldGoldReceipt(conn, req, receipt, reason, fx);
    for (const saleId of saleIds) await recomputeSale(conn, saleId);
  });
  await sendCancel(res, outcome, () => findOldGold(pool, id));
});

// Only notes can change. A cancelled receipt can be deleted with its lines and cancelled credit receipt;
// the stock items made from it stay (inactive) because stock history points at them.
cancelledRecordRoutes(router, {
  table: 'old_gold_receipts',
  module: 'old_gold',
  fields: z.object({ notes: optionalText(255) }),
  find: findOldGold,
  children: async (conn, receipt) => {
    const payments = await snapshot(conn, 'customer_payments', 'old_gold_id = ?', [receipt.id]);
    if (payments.some((p) => p.status !== 'cancelled')) throw new HttpError(400, 'Its credit receipt is still active. Cancel it first.');
    const lines = await snapshot(conn, 'old_gold_lines', 'receipt_id = ?', [receipt.id]);
    return [
      { table: 'old_gold_lines', rows: lines },
      { table: 'customer_payments', rows: payments },
    ];
  },
});

export default router;
