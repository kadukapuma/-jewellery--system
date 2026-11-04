import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';

const router = Router();

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  phone: optionalText(30),
  nic: optionalText(20),
  address: optionalText(255),
  credit_limit: z.coerce.number().min(0, 'Cannot be negative').max(1e12).default(0),
  opening_balance: z.coerce.number().min(-1e12).max(1e12).default(0),
});

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  owing: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

// balance > 0 = the customer owes the shop; < 0 = the customer has money with the shop (advance).
const CUSTOMER_SELECT = `
  SELECT c.*, b.balance,
         (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed') AS sale_count,
         (SELECT MAX(s.sale_date) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed') AS last_sale_date,
         (SELECT COALESCE(SUM(s.balance), 0) FROM sales s
          WHERE s.customer_id = c.id AND s.status = 'completed' AND s.balance > 0 AND s.due_date < CURDATE()) AS overdue,
         (SELECT COUNT(*) FROM customer_payments p WHERE p.customer_id = c.id) AS payment_count
  FROM customers c JOIN v_customer_balances b ON b.customer_id = c.id`;

function toCustomer(row) {
  return { ...row, balance: Number(row.balance), overdue: Number(row.overdue) };
}

export async function findCustomer(db, id) {
  const [rows] = await db.query(`${CUSTOMER_SELECT} WHERE c.id = ?`, [id]);
  if (!rows.length) throw new HttpError(404, 'Customer not found');
  return toCustomer(rows[0]);
}

// The sales counter searches customers too.
router.get('/', requirePermission('customers.view', 'sales.create'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.nic LIKE ?)');
    params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  }
  if (q.owing === 'true') where.push('b.balance > 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total, owed }]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(GREATEST(b.balance, 0)), 0) AS owed
     FROM customers c JOIN v_customer_balances b ON b.customer_id = c.id ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(`${CUSTOMER_SELECT} ${whereSql} ORDER BY c.name LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({ total, owed: Number(owed), customers: rows.map(toCustomer) });
});

router.get('/:id', requirePermission('customers.view', 'sales.create'), async (req, res) => {
  res.json(await findCustomer(pool, parseId(req.params.id)));
});

// Opening balance, every bill (+) and payment (-), with a running balance.
router.get('/:id/statement', requirePermission('customers.view', 'customer_payments.view'), async (req, res) => {
  const customer = await findCustomer(pool, parseId(req.params.id));
  const [rows] = await pool.query(
    `SELECT 'sale' AS type, s.id, s.invoice_no AS ref, s.sale_date AS date, s.total AS amount, s.created_at
     FROM sales s WHERE s.customer_id = ? AND s.status = 'completed'
     UNION ALL
     SELECT 'payment', p.id, p.receipt_no, p.payment_date, -p.amount, p.created_at
     FROM customer_payments p WHERE p.customer_id = ? AND p.status = 'active'
     ORDER BY date, created_at`,
    [customer.id, customer.id],
  );
  let running = Number(customer.opening_balance);
  const entries = rows.map((r) => {
    running = Math.round((running + Number(r.amount)) * 100) / 100;
    return { ...r, amount: Number(r.amount), balance: running };
  });
  res.json({ customer, opening_balance: Number(customer.opening_balance), entries, closing_balance: running });
});

router.post('/', requirePermission('customers.create'), async (req, res) => {
  const data = customerSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      'INSERT INTO customers (name, phone, nic, address, credit_limit, opening_balance) VALUES (?, ?, ?, ?, ?, ?)',
      [data.name, data.phone, data.nic, data.address, data.credit_limit, data.opening_balance],
    );
    await writeAudit(conn, req, { action: 'create', table: 'customers', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findCustomer(pool, id));
});

router.put('/:id', requirePermission('customers.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = customerSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const [[before]] = await conn.query('SELECT * FROM customers WHERE id = ?', [id]);
    if (!before) throw new HttpError(404, 'Customer not found');
    await conn.query(
      'UPDATE customers SET name = ?, phone = ?, nic = ?, address = ?, credit_limit = ?, opening_balance = ? WHERE id = ?',
      [data.name, data.phone, data.nic, data.address, data.credit_limit, data.opening_balance, id],
    );
    await writeAudit(conn, req, { action: 'update', table: 'customers', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findCustomer(pool, id));
});

router.delete('/:id', requirePermission('customers.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const c = await findCustomer(conn, id);
    const [[{ n }]] = await conn.query(
      'SELECT (SELECT COUNT(*) FROM sales WHERE customer_id = ?) + (SELECT COUNT(*) FROM craft_jobs WHERE customer_id = ?) AS n',
      [id, id],
    );
    if (n > 0 || c.payment_count) throw new HttpError(400, `${c.name} has bills or payments and cannot be deleted.`);
    await conn.query('DELETE FROM customers WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'customers', recordId: id, oldValues: c });
  });
  res.status(204).end();
});

export default router;
