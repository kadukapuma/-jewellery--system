import { Router } from 'express';
import { assertDayOpen } from '../../utils/dayLock.js';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { PAYMENT_METHODS, dateSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { cancelReason, money, runCancel, sendCancel } from '../../utils/cancelEffects.js';
import { cancelledRecordRoutes } from '../../utils/cancelledRecords.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { allocateCustomerPayment, recomputeSale } from './customer-payments.service.js';

const router = Router();

const createSchema = z.object({
  customer_id: z.coerce.number({ error: 'Choose a customer' }).int().positive('Choose a customer'),
  payment_date: dateSchema,
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Amount must be above 0').max(1e12),
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how it was paid' }),
  reference_no: optionalText(50),
  cheque_date: dateSchema.optional().nullable().or(z.literal('').transform(() => null)),
  notes: optionalText(255),
  sale_id: z.coerce.number().int().positive().optional().nullable(), // settle this bill first
});

const listSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'cancelled', 'all']).default('active'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const PAYMENT_SELECT = `
  SELECT p.*, c.name AS customer_name, c.phone AS customer_phone, s.invoice_no AS counter_invoice_no, u.name AS created_by_name,
         COALESCE((SELECT SUM(a.amount) FROM customer_payment_allocations a WHERE a.payment_id = p.id), 0) AS allocated
  FROM customer_payments p
  LEFT JOIN customers c ON c.id = p.customer_id
  LEFT JOIN sales s ON s.id = p.sale_id
  JOIN users u ON u.id = p.created_by`;

async function findPayment(db, id) {
  const [[payment]] = await db.query(`${PAYMENT_SELECT} WHERE p.id = ?`, [id]);
  if (!payment) throw new HttpError(404, 'Payment not found');
  const [allocations] = await db.query(
    `SELECT a.amount, s.id AS sale_id, s.invoice_no, s.sale_date
     FROM customer_payment_allocations a JOIN sales s ON s.id = a.sale_id
     WHERE a.payment_id = ? ORDER BY s.sale_date, s.id`,
    [id],
  );
  const allocated = Number(payment.allocated);
  return { ...payment, allocated, unallocated: Math.round((payment.amount - allocated) * 100) / 100, allocations };
}

router.get('/', requirePermission('customer_payments.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.customer_id) { where.push('p.customer_id = ?'); params.push(q.customer_id); }
  if (q.status !== 'all') { where.push('p.status = ?'); params.push(q.status); }
  if (q.from) { where.push('p.payment_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('p.payment_date < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total, amount }]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(p.amount), 0) AS amount FROM customer_payments p ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(`${PAYMENT_SELECT} ${whereSql} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({
    total,
    sum_amount: Number(amount),
    payments: rows.map((r) => ({ ...r, allocated: Number(r.allocated), unallocated: Math.round((r.amount - r.allocated) * 100) / 100 })),
  });
});

router.get('/:id', requirePermission('customer_payments.view'), async (req, res) => {
  res.json(await findPayment(pool, parseId(req.params.id)));
});

// Money received from a customer later (credit / instalments / advance).
router.post('/', requirePermission('customer_payments.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    await assertDayOpen(conn, data.payment_date);
    const [[customer]] = await conn.query('SELECT id FROM customers WHERE id = ?', [data.customer_id]);
    if (!customer) throw new HttpError(400, 'Customer not found');
    if (data.sale_id) {
      const [[s]] = await conn.query('SELECT customer_id FROM sales WHERE id = ?', [data.sale_id]);
      if (s?.customer_id !== customer.id) throw new HttpError(400, 'That bill is not for this customer');
    }
    const receiptNo = await nextDocumentNumber(conn, 'RCP');
    const [result] = await conn.query(
      `INSERT INTO customer_payments (receipt_no, customer_id, payment_date, amount, method, reference_no, cheque_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiptNo, customer.id, data.payment_date, data.amount, data.method, data.reference_no, data.cheque_date ?? null, data.notes, req.user.id],
    );
    await allocateCustomerPayment(conn, { paymentId: result.insertId, customerId: customer.id, amount: data.amount, firstSaleId: data.sale_id });
    await writeAudit(conn, req, { action: 'create', table: 'customer_payments', recordId: result.insertId, newValues: { ...data, receipt_no: receiptNo } });
    return result.insertId;
  });
  res.status(201).json(await findPayment(pool, id));
});

router.post('/:id/cancel', requirePermission('customer_payments.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = cancelReason(req);
  const outcome = await runCancel(req, { table: 'customer_payments', recordId: id }, async (conn, fx) => {
    const payment = await findPayment(conn, id);
    if (payment.status === 'cancelled') throw new HttpError(400, 'This receipt is already cancelled');
    if (payment.old_gold_id) throw new HttpError(400, 'This is the value of old gold taken in. Cancel it from Old Gold (the gold goes back to the customer).');
    await assertDayOpen(conn, payment.payment_date);
    await fx.watchCustomer(conn, payment.customer_id);
    await fx.watchSales(conn, payment.allocations.map((a) => a.sale_id));
    if (payment.unallocated > 0.009) fx.add('customer', `${money(payment.unallocated)} of it was an advance: that advance is gone`);
    await conn.query(
      "UPDATE customer_payments SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE id = ?",
      [reason ? `Cancelled: ${reason}` : 'Cancelled', id],
    );
    await conn.query('DELETE FROM customer_payment_allocations WHERE payment_id = ?', [id]);
    for (const a of payment.allocations) await recomputeSale(conn, a.sale_id);
    await writeAudit(conn, req, {
      action: 'cancel', table: 'customer_payments', recordId: id,
      oldValues: { receipt_no: payment.receipt_no, amount: payment.amount, allocations: payment.allocations }, newValues: { reason },
    });
  });
  await sendCancel(res, outcome, () => findPayment(pool, id));
});

cancelledRecordRoutes(router, {
  table: 'customer_payments',
  module: 'customer_payments',
  fields: z.object({ reference_no: optionalText(50), cheque_date: dateSchema.optional().nullable().or(z.literal('').transform(() => null)), notes: optionalText(255) }),
  find: findPayment,
});

export default router;
