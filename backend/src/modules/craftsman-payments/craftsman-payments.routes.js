import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { dateSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { nextDocumentNumber } from '../../utils/sequences.js';

const router = Router();

const createSchema = z.object({
  craftsman_id: z.coerce.number({ error: 'Choose a craftsman' }).int().positive('Choose a craftsman'),
  payment_date: dateSchema,
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Amount must be above 0').max(1e12),
  method: z.enum(['cash', 'bank_transfer', 'cheque'], { error: 'Choose how it was paid' }),
  reference_no: optionalText(50),
  notes: optionalText(255),
  craft_job_id: z.coerce.number().int().positive().optional().nullable(),
});

const listSchema = z.object({
  craftsman_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'cancelled', 'all']).default('active'),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const PAYMENT_SELECT = `
  SELECT p.*, c.name AS craftsman_name, j.job_no, u.name AS created_by_name
  FROM craftsman_payments p
  JOIN craftsmen c ON c.id = p.craftsman_id
  LEFT JOIN craft_jobs j ON j.id = p.craft_job_id
  JOIN users u ON u.id = p.created_by`;

async function findPayment(db, id) {
  const [[row]] = await db.query(`${PAYMENT_SELECT} WHERE p.id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Payment not found');
  return row;
}

router.get('/', requirePermission('craftsman_account.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.craftsman_id) { where.push('p.craftsman_id = ?'); params.push(q.craftsman_id); }
  if (q.status !== 'all') { where.push('p.status = ?'); params.push(q.status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total, amount }]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(p.amount), 0) AS amount FROM craftsman_payments p ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(`${PAYMENT_SELECT} ${whereSql} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({ total, sum_amount: Number(amount), payments: rows });
});

router.post('/', requirePermission('craftsman_payments.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [[craftsman]] = await conn.query('SELECT id FROM craftsmen WHERE id = ?', [data.craftsman_id]);
    if (!craftsman) throw new HttpError(400, 'Craftsman not found');
    if (data.craft_job_id) {
      const [[job]] = await conn.query('SELECT craftsman_id FROM craft_jobs WHERE id = ?', [data.craft_job_id]);
      if (job?.craftsman_id !== data.craftsman_id) throw new HttpError(400, 'That job belongs to another craftsman');
    }
    const paymentNo = await nextDocumentNumber(conn, 'CPY');
    const [result] = await conn.query(
      `INSERT INTO craftsman_payments (payment_no, craftsman_id, craft_job_id, payment_date, amount, method, reference_no, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentNo, data.craftsman_id, data.craft_job_id ?? null, data.payment_date, data.amount, data.method, data.reference_no, data.notes, req.user.id],
    );
    await writeAudit(conn, req, { action: 'create', table: 'craftsman_payments', recordId: result.insertId, newValues: { ...data, payment_no: paymentNo } });
    return result.insertId;
  });
  res.status(201).json(await findPayment(pool, id));
});

router.post('/:id/cancel', requirePermission('craftsman_payments.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = optionalText(255).parse(req.body?.reason);
  await withTransaction(async (conn) => {
    const payment = await findPayment(conn, id);
    if (payment.status === 'cancelled') throw new HttpError(400, 'This payment is already cancelled');
    await conn.query(
      "UPDATE craftsman_payments SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE id = ?",
      [reason ? `Cancelled: ${reason}` : 'Cancelled', id],
    );
    await writeAudit(conn, req, { action: 'cancel', table: 'craftsman_payments', recordId: id, oldValues: { payment_no: payment.payment_no, amount: payment.amount }, newValues: { reason } });
  });
  res.json(await findPayment(pool, id));
});

export default router;
