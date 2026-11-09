import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { PAYMENT_METHODS, dateSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { cancelledRecordRoutes } from '../../utils/cancelledRecords.js';
import { adminApproval } from '../../utils/changeGuard.js';
import { nextDocumentNumber } from '../../utils/sequences.js';

const router = Router();

const createSchema = z.object({
  expense_date: dateSchema,
  category_id: z.coerce.number({ error: 'Choose a category' }).int().positive('Choose a category'),
  paid_to: optionalText(150),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Amount must be above 0').max(1e12),
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how it was paid' }),
  reference_no: optionalText(50),
  notes: optionalText(255),
});

const listSchema = z.object({
  category_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'cancelled', 'all']).default('active'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const categorySchema = z.object({
  name: z.string({ error: 'Enter a name' }).trim().min(1, 'Enter a name').max(100),
  is_active: z.coerce.boolean().default(true),
});

const EXPENSE_SELECT = `
  SELECT e.*, ec.name AS category_name, u.name AS created_by_name
  FROM expenses e
  JOIN expense_categories ec ON ec.id = e.category_id
  JOIN users u ON u.id = e.created_by`;

async function findExpense(db, id) {
  const [[row]] = await db.query(`${EXPENSE_SELECT} WHERE e.id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Expense not found');
  return row;
}

// --- Categories (before /:id so "categories" is not read as an id) ---

router.get('/categories', requirePermission('expenses.view', 'expenses.create'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ec.*, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = ec.id) AS expense_count
     FROM expense_categories ec ORDER BY ec.name`,
  );
  res.json(rows);
});

router.post('/categories', requirePermission('expenses.create'), async (req, res) => {
  const data = categorySchema.parse(req.body);
  const [[dupe]] = await pool.query('SELECT id FROM expense_categories WHERE name = ?', [data.name]);
  if (dupe) throw new HttpError(400, 'A category with this name already exists');
  const [result] = await pool.query('INSERT INTO expense_categories (name, is_active) VALUES (?, ?)', [data.name, data.is_active ? 1 : 0]);
  await writeAudit(pool, req, { action: 'create', table: 'expense_categories', recordId: result.insertId, newValues: data });
  const [[row]] = await pool.query('SELECT * FROM expense_categories WHERE id = ?', [result.insertId]);
  res.status(201).json(row);
});

router.put('/categories/:id', requirePermission('expenses.create'), adminApproval('expense_categories.update', { table: 'expense_categories', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const data = categorySchema.parse(req.body);
  const [[old]] = await pool.query('SELECT * FROM expense_categories WHERE id = ?', [id]);
  if (!old) throw new HttpError(404, 'Category not found');
  const [[dupe]] = await pool.query('SELECT id FROM expense_categories WHERE name = ? AND id <> ?', [data.name, id]);
  if (dupe) throw new HttpError(400, 'A category with this name already exists');
  await pool.query('UPDATE expense_categories SET name = ?, is_active = ? WHERE id = ?', [data.name, data.is_active ? 1 : 0, id]);
  await writeAudit(pool, req, { action: 'update', table: 'expense_categories', recordId: id, oldValues: { name: old.name, is_active: old.is_active }, newValues: data });
  const [[row]] = await pool.query('SELECT * FROM expense_categories WHERE id = ?', [id]);
  res.json(row);
}));

// --- Expenses ---

router.get('/', requirePermission('expenses.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.category_id) { where.push('e.category_id = ?'); params.push(q.category_id); }
  if (q.status !== 'all') { where.push('e.status = ?'); params.push(q.status); }
  if (q.from) { where.push('e.expense_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('e.expense_date <= ?'); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total, amount }]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(e.amount), 0) AS amount FROM expenses e ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(`${EXPENSE_SELECT} ${whereSql} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({ total, sum_amount: Number(amount), expenses: rows });
});

router.get('/:id', requirePermission('expenses.view'), async (req, res) => {
  res.json(await findExpense(pool, parseId(req.params.id)));
});

router.post('/', requirePermission('expenses.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [[category]] = await conn.query('SELECT id, is_active FROM expense_categories WHERE id = ?', [data.category_id]);
    if (!category) throw new HttpError(400, 'Category not found');
    if (!category.is_active) throw new HttpError(400, 'This category is no longer in use');
    const expenseNo = await nextDocumentNumber(conn, 'EXP');
    const [result] = await conn.query(
      `INSERT INTO expenses (expense_no, expense_date, category_id, paid_to, amount, method, reference_no, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [expenseNo, data.expense_date, data.category_id, data.paid_to, data.amount, data.method, data.reference_no, data.notes, req.user.id],
    );
    await writeAudit(conn, req, { action: 'create', table: 'expenses', recordId: result.insertId, newValues: { ...data, expense_no: expenseNo } });
    return result.insertId;
  });
  res.status(201).json(await findExpense(pool, id));
});

router.post('/:id/cancel', requirePermission('expenses.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = optionalText(255).parse(req.body?.reason);
  await withTransaction(async (conn) => {
    const expense = await findExpense(conn, id);
    if (expense.status === 'cancelled') throw new HttpError(400, 'This expense is already cancelled');
    await conn.query(
      "UPDATE expenses SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE id = ?",
      [reason ? `Cancelled: ${reason}` : 'Cancelled', id],
    );
    await writeAudit(conn, req, { action: 'cancel', table: 'expenses', recordId: id, oldValues: { expense_no: expense.expense_no, amount: expense.amount }, newValues: { reason } });
  });
  res.json(await findExpense(pool, id));
});

cancelledRecordRoutes(router, {
  table: 'expenses',
  module: 'expenses',
  fields: z.object({ reference_no: optionalText(50), notes: optionalText(255) }),
  find: findExpense,
});

export default router;
