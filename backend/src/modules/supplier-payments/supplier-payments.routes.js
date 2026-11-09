import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { PAYMENT_METHODS, dateSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { cancelledRecordRoutes } from '../../utils/cancelledRecords.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { allocatePayment, recomputePurchase } from './supplier-payments.service.js';

const router = Router();

const createSchema = z.object({
  supplier_id: z.coerce.number({ error: 'Choose a supplier' }).int().positive('Choose a supplier'),
  payment_date: dateSchema,
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Amount must be above 0').max(1e12),
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how it was paid' }),
  reference_no: optionalText(50),
  cheque_date: dateSchema.optional().nullable().or(z.literal('').transform(() => null)),
  notes: optionalText(255),
  purchase_id: z.coerce.number().int().positive().optional().nullable(), // settle this purchase first
});

const listSchema = z.object({
  supplier_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'cancelled', 'all']).default('active'),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const PAYMENT_SELECT = `
  SELECT sp.*, s.name AS supplier_name, u.name AS created_by_name,
         COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.payment_id = sp.id), 0) AS allocated
  FROM supplier_payments sp
  JOIN suppliers s ON s.id = sp.supplier_id
  JOIN users u ON u.id = sp.created_by`;

async function findPayment(db, id) {
  const [[payment]] = await db.query(`${PAYMENT_SELECT} WHERE sp.id = ?`, [id]);
  if (!payment) throw new HttpError(404, 'Payment not found');
  const [allocations] = await db.query(
    `SELECT a.amount, p.id AS purchase_id, p.purchase_no, p.purchase_date, p.supplier_invoice_no
     FROM supplier_payment_allocations a JOIN purchases p ON p.id = a.purchase_id
     WHERE a.payment_id = ? ORDER BY p.purchase_date, p.id`,
    [id],
  );
  const allocated = Number(payment.allocated);
  return { ...payment, allocated, unallocated: Math.round((payment.amount - allocated) * 100) / 100, allocations };
}

router.get('/', requirePermission('supplier_payments.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.supplier_id) { where.push('sp.supplier_id = ?'); params.push(q.supplier_id); }
  if (q.status !== 'all') { where.push('sp.status = ?'); params.push(q.status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total, amount }]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(sp.amount), 0) AS amount FROM supplier_payments sp ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(`${PAYMENT_SELECT} ${whereSql} ORDER BY sp.payment_date DESC, sp.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({
    total,
    sum_amount: Number(amount),
    payments: rows.map((r) => ({ ...r, allocated: Number(r.allocated), unallocated: Math.round((r.amount - r.allocated) * 100) / 100 })),
  });
});

router.get('/:id', requirePermission('supplier_payments.view'), async (req, res) => {
  res.json(await findPayment(pool, parseId(req.params.id)));
});

router.post('/', requirePermission('supplier_payments.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [[supplier]] = await conn.query('SELECT id FROM suppliers WHERE id = ?', [data.supplier_id]);
    if (!supplier) throw new HttpError(400, 'Supplier not found');
    if (data.purchase_id) {
      const [[p]] = await conn.query('SELECT supplier_id FROM purchases WHERE id = ?', [data.purchase_id]);
      if (p?.supplier_id !== supplier.id) throw new HttpError(400, 'That purchase is not from this supplier');
    }
    const paymentNo = await nextDocumentNumber(conn, 'SPY');
    const [result] = await conn.query(
      `INSERT INTO supplier_payments (payment_no, supplier_id, payment_date, amount, method, reference_no, cheque_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentNo, supplier.id, data.payment_date, data.amount, data.method, data.reference_no, data.cheque_date ?? null, data.notes, req.user.id],
    );
    await allocatePayment(conn, { paymentId: result.insertId, supplierId: supplier.id, amount: data.amount, firstPurchaseId: data.purchase_id });
    await writeAudit(conn, req, { action: 'create', table: 'supplier_payments', recordId: result.insertId, newValues: { ...data, payment_no: paymentNo } });
    return result.insertId;
  });
  res.status(201).json(await findPayment(pool, id));
});

// Cancelling un-settles the purchases it paid; the record stays for the history.
router.post('/:id/cancel', requirePermission('supplier_payments.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = optionalText(255).parse(req.body?.reason);
  await withTransaction(async (conn) => {
    const payment = await findPayment(conn, id);
    if (payment.status === 'cancelled') throw new HttpError(400, 'This payment is already cancelled');
    await conn.query(
      "UPDATE supplier_payments SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE id = ?",
      [reason ? `Cancelled: ${reason}` : 'Cancelled', id],
    );
    await conn.query('DELETE FROM supplier_payment_allocations WHERE payment_id = ?', [id]);
    for (const a of payment.allocations) await recomputePurchase(conn, a.purchase_id);
    await writeAudit(conn, req, {
      action: 'cancel',
      table: 'supplier_payments',
      recordId: id,
      oldValues: { payment_no: payment.payment_no, amount: payment.amount, allocations: payment.allocations },
      newValues: { reason },
    });
  });
  res.json(await findPayment(pool, id));
});

cancelledRecordRoutes(router, {
  table: 'supplier_payments',
  module: 'supplier_payments',
  fields: z.object({ reference_no: optionalText(50), cheque_date: dateSchema.optional().nullable().or(z.literal('').transform(() => null)), notes: optionalText(255) }),
  find: findPayment,
});

export default router;
