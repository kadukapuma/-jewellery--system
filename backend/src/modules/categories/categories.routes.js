import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { binRecord } from '../../utils/recycleBin.js';
import { adminApproval } from '../../utils/changeGuard.js';

const router = Router();

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  category_type: z.enum(['jewellery', 'biscuit', 'other'], { error: 'Choose a type' }),
  description: optionalText(255),
  is_active: z.boolean(),
});

function toCategory(row) {
  return { ...row, is_active: !!row.is_active };
}

async function findCategory(db, id) {
  const [rows] = await db.query('SELECT * FROM categories WHERE id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'Category not found');
  return toCategory(rows[0]);
}

// Item screens need the category list too.
router.get('/', requirePermission('categories.view', 'items.view'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS item_count,
            (SELECT COALESCE(SUM(i.stock_qty), 0) FROM items i WHERE i.category_id = c.id AND i.status = 'in_stock') AS in_stock_qty
     FROM categories c ORDER BY c.name`,
  );
  res.json(rows.map((r) => ({ ...toCategory(r), in_stock_qty: Number(r.in_stock_qty) })));
});

router.post('/', requirePermission('categories.create'), async (req, res) => {
  const data = categorySchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      'INSERT INTO categories (name, category_type, description, is_active) VALUES (?, ?, ?, ?)',
      [data.name, data.category_type, data.description, data.is_active ? 1 : 0],
    );
    await writeAudit(conn, req, { action: 'create', table: 'categories', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findCategory(pool, id));
});

router.put('/:id', requirePermission('categories.edit'), adminApproval('categories.update', { table: 'categories', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const data = categorySchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findCategory(conn, id);
    await conn.query('UPDATE categories SET name = ?, category_type = ?, description = ?, is_active = ? WHERE id = ?', [
      data.name, data.category_type, data.description, data.is_active ? 1 : 0, id,
    ]);
    await writeAudit(conn, req, { action: 'update', table: 'categories', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findCategory(pool, id));
}));

router.delete('/:id', requirePermission('categories.delete'), adminApproval('categories.delete', { table: 'categories', action: 'delete' }, async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const category = await findCategory(conn, id);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM items WHERE category_id = ?', [id]);
    if (n > 0) throw new HttpError(400, `${category.name} has ${n} item(s) and cannot be deleted. Disable it instead.`);
    await binRecord(conn, req, 'categories', id);
    await conn.query('DELETE FROM categories WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'categories', recordId: id, oldValues: category });
  });
  res.status(204).end();
}));

export default router;
