import { Router } from 'express';
import { assertDayOpen } from '../../utils/dayLock.js';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { dateSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { cancelReason, runCancel, sendCancel } from '../../utils/cancelEffects.js';
import { cancelledRecordRoutes } from '../../utils/cancelledRecords.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { MONEY_FLOW_SQL, OWNER_KINDS, TRANSFER_KINDS, accountBalances } from './finance.service.js';

const router = Router();

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const rangeSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((r) => r.from <= r.to, { message: '"From" must be before "To"', path: ['to'] });

const IN_RANGE = 'f.txn_date BETWEEN ? AND ?';
const TRADING = `f.kind NOT IN (${[...TRANSFER_KINDS, ...OWNER_KINDS].map((k) => `'${k}'`).join(', ')})`;

// Money in vs out for a period, balances right now, and who owes whom.
router.get('/overview', requirePermission('finance.view'), async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  const range = [from, to];

  const [byKind] = await pool.query(
    `SELECT f.kind, f.direction, COUNT(*) AS count, SUM(f.amount) AS amount
     FROM (${MONEY_FLOW_SQL}) f WHERE ${IN_RANGE} AND f.kind NOT IN ('deposit', 'withdrawal')
     GROUP BY f.kind, f.direction`,
    range,
  );
  const [byDay] = await pool.query(
    `SELECT f.txn_date AS day,
            SUM(CASE WHEN f.direction > 0 THEN f.amount ELSE 0 END) AS money_in,
            SUM(CASE WHEN f.direction < 0 THEN f.amount ELSE 0 END) AS money_out
     FROM (${MONEY_FLOW_SQL}) f WHERE ${IN_RANGE} AND ${TRADING}
     GROUP BY f.txn_date ORDER BY f.txn_date`,
    range,
  );
  const [byMethod] = await pool.query(
    `SELECT f.method AS label,
            SUM(CASE WHEN f.direction > 0 THEN f.amount ELSE 0 END) AS money_in,
            SUM(CASE WHEN f.direction < 0 THEN f.amount ELSE 0 END) AS money_out
     FROM (${MONEY_FLOW_SQL}) f WHERE ${IN_RANGE} AND ${TRADING}
     GROUP BY f.method ORDER BY money_in + money_out DESC`,
    range,
  );
  const [expensesByCategory] = await pool.query(
    `SELECT ec.name AS label, COUNT(*) AS count, SUM(e.amount) AS amount
     FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.status = 'active' AND e.expense_date BETWEEN ? AND ?
     GROUP BY ec.id ORDER BY amount DESC`,
    range,
  );
  const [recent] = await pool.query(
    `SELECT f.* FROM (${MONEY_FLOW_SQL}) f WHERE ${IN_RANGE}
     ORDER BY f.txn_date DESC, f.kind, f.ref_id DESC LIMIT 500`,
    range,
  );
  const [[outstanding]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(balance), 0) FROM v_customer_balances WHERE balance > 0) AS receivables,
            (SELECT COALESCE(SUM(balance), 0) FROM v_supplier_balances WHERE balance > 0) AS payables,
            (SELECT COALESCE(SUM(cash_due), 0) FROM v_craftsman_balances WHERE cash_due > 0) AS craftsman_due`,
  );

  const sumKind = (kind) => round2(byKind.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.amount), 0));
  const countKind = (kind) => byKind.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.count), 0);
  const totals = {
    receipts: sumKind('receipt'),
    supplier_payments: sumKind('supplier_payment'),
    craftsman_payments: sumKind('craftsman_payment'),
    expenses: sumKind('expense'),
    old_gold: sumKind('old_gold'),
    opening: sumKind('opening'),
    capital_in: sumKind('capital_in'),
    drawings: sumKind('drawing'),
    counts: {
      receipts: countKind('receipt'), supplier_payments: countKind('supplier_payment'),
      craftsman_payments: countKind('craftsman_payment'), expenses: countKind('expense'), old_gold: countKind('old_gold'),
    },
  };
  totals.money_in = totals.receipts;
  totals.money_out = round2(totals.supplier_payments + totals.craftsman_payments + totals.expenses + totals.old_gold);
  totals.net = round2(totals.money_in - totals.money_out);

  const num = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, round2(r[k])])) }));
  res.json({
    from, to,
    balances: await accountBalances(pool),
    totals,
    by_day: num(byDay, ['money_in', 'money_out']),
    by_method: num(byMethod, ['money_in', 'money_out']),
    expenses_by_category: num(expensesByCategory, ['amount']),
    outstanding: {
      receivables: round2(outstanding.receivables),
      payables: round2(outstanding.payables),
      craftsman_due: round2(outstanding.craftsman_due),
    },
    recent: num(recent, ['amount']),
  });
});

// ---------------------------------------------------------------------
// Cash / bank entries: opening balances, owner capital and drawings, transfers.
// ---------------------------------------------------------------------
const ENTRY_TYPES = ['opening', 'capital_in', 'drawing', 'deposit', 'withdrawal'];

const entrySchema = z.object({
  entry_date: dateSchema,
  entry_type: z.enum(ENTRY_TYPES, { error: 'Choose the type of entry' }),
  account: z.enum(['cash', 'bank'], { error: 'Choose cash or bank' }).default('cash'),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Amount must be above 0').max(1e12),
  notes: optionalText(255),
});

const entryListSchema = z.object({
  status: z.enum(['active', 'cancelled', 'all']).default('active'),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const ENTRY_SELECT = `
  SELECT ce.*, u.name AS created_by_name
  FROM cash_entries ce JOIN users u ON u.id = ce.created_by`;

async function findEntry(db, id) {
  const [[row]] = await db.query(`${ENTRY_SELECT} WHERE ce.id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Entry not found');
  return row;
}

// The account money leaves for this entry, or null when it only adds money.
const accountTakenFrom = (e) => ({ drawing: e.account, deposit: 'cash', withdrawal: 'bank' }[e.entry_type] ?? null);

router.get('/balances', requirePermission('finance.view'), async (req, res) => {
  res.json(await accountBalances(pool));
});

router.get('/cash-entries', requirePermission('finance.view'), async (req, res) => {
  const q = entryListSchema.parse(req.query);
  const whereSql = q.status !== 'all' ? 'WHERE ce.status = ?' : '';
  const params = q.status !== 'all' ? [q.status] : [];
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM cash_entries ce ${whereSql}`, params);
  const [rows] = await pool.query(`${ENTRY_SELECT} ${whereSql} ORDER BY ce.entry_date DESC, ce.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({ total, entries: rows });
});

router.post('/cash-entries', requirePermission('cash_entries.create'), async (req, res) => {
  const data = entrySchema.parse(req.body);
  if (TRANSFER_KINDS.includes(data.entry_type)) data.account = data.entry_type === 'deposit' ? 'cash' : 'bank';
  const id = await withTransaction(async (conn) => {
    await assertDayOpen(conn, data.entry_date);
    const from = accountTakenFrom(data);
    if (from) {
      // Lock the entries table so two withdrawals at once cannot both pass the balance check.
      await conn.query('SELECT id FROM cash_entries ORDER BY id DESC LIMIT 1 FOR UPDATE');
      const balance = (await accountBalances(conn))[from];
      if (data.amount > balance) {
        throw new HttpError(400, `Only ${balance.toFixed(2)} in ${from === 'cash' ? 'cash' : 'the bank'} – cannot take out ${data.amount.toFixed(2)}`);
      }
    }
    const entryNo = await nextDocumentNumber(conn, 'CSH');
    const [result] = await conn.query(
      `INSERT INTO cash_entries (entry_no, entry_date, entry_type, account, amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entryNo, data.entry_date, data.entry_type, data.account, data.amount, data.notes, req.user.id],
    );
    await writeAudit(conn, req, { action: 'create', table: 'cash_entries', recordId: result.insertId, newValues: { ...data, entry_no: entryNo } });
    return result.insertId;
  });
  res.status(201).json(await findEntry(pool, id));
});

router.post('/cash-entries/:id/cancel', requirePermission('cash_entries.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = cancelReason(req);
  const outcome = await runCancel(req, { table: 'cash_entries', recordId: id }, async (conn) => {
    const entry = await findEntry(conn, id);
    if (entry.status === 'cancelled') throw new HttpError(400, 'This entry is already cancelled');
    await assertDayOpen(conn, entry.entry_date);
    await conn.query(
      "UPDATE cash_entries SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE id = ?",
      [reason ? `Cancelled: ${reason}` : 'Cancelled', id],
    );
    await writeAudit(conn, req, { action: 'cancel', table: 'cash_entries', recordId: id, oldValues: { entry_no: entry.entry_no, amount: entry.amount }, newValues: { reason } });
  });
  await sendCancel(res, outcome, () => findEntry(pool, id));
});

cancelledRecordRoutes(router, {
  path: '/cash-entries/:id',
  table: 'cash_entries',
  module: 'cash_entries',
  fields: z.object({ notes: optionalText(255) }),
  find: findEntry,
});

export default router;
