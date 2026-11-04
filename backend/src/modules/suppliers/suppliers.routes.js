import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { optionalEmail, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';

const router = Router();

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  phone: optionalText(30),
  email: optionalEmail,
  address: optionalText(255),
  opening_balance: z.coerce.number().min(-1e12).max(1e12).default(0),
  credit_days: z.coerce.number().int('Whole days only').min(0, 'Cannot be negative').max(365).default(0),
  is_active: z.boolean(),
});

// balance > 0 = we owe the supplier; < 0 = we paid in advance.
const SUPPLIER_SELECT = `
  SELECT s.*, b.balance,
         (SELECT COALESCE(SUM(p.balance), 0) FROM purchases p
          WHERE p.supplier_id = s.id AND p.balance > 0 AND p.due_date < CURDATE()) AS overdue,
         (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchase_count,
         (SELECT COUNT(*) FROM supplier_payments sp WHERE sp.supplier_id = s.id) AS payment_count,
         (SELECT MAX(p.purchase_date) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase_date
  FROM suppliers s JOIN v_supplier_balances b ON b.supplier_id = s.id`;

function toSupplier(row) {
  return { ...row, is_active: !!row.is_active, balance: Number(row.balance), overdue: Number(row.overdue) };
}

export async function findSupplier(db, id) {
  const [rows] = await db.query(`${SUPPLIER_SELECT} WHERE s.id = ?`, [id]);
  if (!rows.length) throw new HttpError(404, 'Supplier not found');
  return toSupplier(rows[0]);
}

// Purchase and payment screens need the list too.
router.get('/', requirePermission('suppliers.view', 'purchases.view', 'supplier_payments.view'), async (req, res) => {
  const [rows] = await pool.query(`${SUPPLIER_SELECT} ORDER BY s.name`);
  res.json(rows.map(toSupplier));
});

router.get('/:id', requirePermission('suppliers.view', 'purchases.view', 'supplier_payments.view'), async (req, res) => {
  res.json(await findSupplier(pool, parseId(req.params.id)));
});

// Opening balance, every purchase (+) and payment (-), with a running balance.
router.get('/:id/statement', requirePermission('suppliers.view', 'supplier_payments.view'), async (req, res) => {
  const supplier = await findSupplier(pool, parseId(req.params.id));
  const [rows] = await pool.query(
    `SELECT 'purchase' AS type, p.id, p.purchase_no AS ref, p.supplier_invoice_no AS detail, p.purchase_date AS date,
            p.total_amount AS amount, p.created_at
     FROM purchases p WHERE p.supplier_id = ?
     UNION ALL
     SELECT 'payment', sp.id, sp.payment_no, CONCAT(sp.method, IFNULL(CONCAT(' · ', sp.reference_no), '')), sp.payment_date,
            -sp.amount, sp.created_at
     FROM supplier_payments sp WHERE sp.supplier_id = ? AND sp.status = 'active'
     ORDER BY date, created_at`,
    [supplier.id, supplier.id],
  );
  let running = Number(supplier.opening_balance);
  const entries = rows.map((r) => {
    running = Math.round((running + Number(r.amount)) * 100) / 100;
    return { ...r, amount: Number(r.amount), balance: running };
  });
  res.json({ supplier, opening_balance: Number(supplier.opening_balance), entries, closing_balance: running });
});

router.post('/', requirePermission('suppliers.create'), async (req, res) => {
  const data = supplierSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO suppliers (name, phone, email, address, opening_balance, credit_days, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.phone, data.email, data.address, data.opening_balance, data.credit_days, data.is_active ? 1 : 0],
    );
    await writeAudit(conn, req, { action: 'create', table: 'suppliers', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findSupplier(pool, id));
});

router.put('/:id', requirePermission('suppliers.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = supplierSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const [[before]] = await conn.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (!before) throw new HttpError(404, 'Supplier not found');
    await conn.query(
      `UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, opening_balance = ?, credit_days = ?, is_active = ?
       WHERE id = ?`,
      [data.name, data.phone, data.email, data.address, data.opening_balance, data.credit_days, data.is_active ? 1 : 0, id],
    );
    await writeAudit(conn, req, { action: 'update', table: 'suppliers', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findSupplier(pool, id));
});

router.delete('/:id', requirePermission('suppliers.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const supplier = await findSupplier(conn, id);
    if (supplier.purchase_count || supplier.payment_count) {
      throw new HttpError(400, `${supplier.name} has purchases or payments and cannot be deleted. Disable it instead.`);
    }
    await conn.query('DELETE FROM suppliers WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'suppliers', recordId: id, oldValues: supplier });
  });
  res.status(204).end();
});

export default router;
