import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { optionalEmail, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { binRecord } from '../../utils/recycleBin.js';
import { adminApproval } from '../../utils/changeGuard.js';
import { nextDocumentNumber } from '../../utils/sequences.js';

const router = Router();

const salesmanSchema = z.object({
  code: optionalText(30),
  name: z.string().trim().min(1, 'Name is required').max(150),
  phone: optionalText(30),
  nic: optionalText(30),
  email: optionalEmail,
  address: optionalText(255),
  commission_percent: z.coerce.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%').default(0),
  is_active: z.boolean().default(true),
});

const SALESMAN_SELECT = `
  SELECT sm.*,
         (SELECT COUNT(*) FROM sales s WHERE s.salesman_id = sm.id AND s.status = 'completed') AS sales_count,
         (SELECT COALESCE(SUM(s.total), 0) FROM sales s WHERE s.salesman_id = sm.id AND s.status = 'completed') AS total_sold
  FROM salesmen sm`;

function toSalesman(row) {
  return {
    ...row,
    is_active: !!row.is_active,
    commission_percent: Number(row.commission_percent),
    sales_count: Number(row.sales_count || 0),
    total_sold: Math.round(Number(row.total_sold || 0) * 100) / 100,
  };
}

export async function findSalesman(db, id) {
  const [rows] = await db.query(`${SALESMAN_SELECT} WHERE sm.id = ?`, [id]);
  if (!rows.length) throw new HttpError(404, 'Salesman not found');
  return toSalesman(rows[0]);
}

// List salesmen - also used by sales counter (POS) to choose salesman.
router.get('/', requirePermission('salesmen.view', 'sales.create', 'sales.view'), async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.active === 'true') {
    where.push('sm.is_active = 1');
  }
  const search = req.query.search ? String(req.query.search).trim() : '';
  if (search) {
    where.push('(sm.code LIKE ? OR sm.name LIKE ? OR sm.phone LIKE ? OR sm.nic LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(`${SALESMAN_SELECT} ${whereSql} ORDER BY sm.is_active DESC, sm.name`, params);
  res.json(rows.map(toSalesman));
});

router.get('/:id', requirePermission('salesmen.view'), async (req, res) => {
  res.json(await findSalesman(pool, parseId(req.params.id)));
});

router.post('/', requirePermission('salesmen.create'), async (req, res) => {
  const data = salesmanSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    let code = data.code;
    if (!code) {
      code = await nextDocumentNumber(conn, 'SM');
    } else {
      const [[dup]] = await conn.query('SELECT id FROM salesmen WHERE code = ?', [code]);
      if (dup) throw new HttpError(400, `Code "${code}" is already used by another salesman`);
    }

    const [result] = await conn.query(
      `INSERT INTO salesmen (code, name, phone, nic, email, address, commission_percent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, data.name, data.phone, data.nic, data.email, data.address, data.commission_percent, data.is_active ? 1 : 0],
    );
    await writeAudit(conn, req, { action: 'create', table: 'salesmen', recordId: result.insertId, newValues: { ...data, code } });
    return result.insertId;
  });
  res.status(201).json(await findSalesman(pool, id));
});

router.put('/:id', requirePermission('salesmen.edit'), adminApproval('salesmen.update', { table: 'salesmen', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const data = salesmanSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findSalesman(conn, id);
    const code = data.code || before.code;
    const [[dup]] = await conn.query('SELECT id FROM salesmen WHERE code = ? AND id <> ?', [code, id]);
    if (dup) throw new HttpError(400, `Code "${code}" is already used by another salesman`);

    await conn.query(
      `UPDATE salesmen SET code = ?, name = ?, phone = ?, nic = ?, email = ?, address = ?, commission_percent = ?, is_active = ?
       WHERE id = ?`,
      [code, data.name, data.phone, data.nic, data.email, data.address, data.commission_percent, data.is_active ? 1 : 0, id],
    );
    await writeAudit(conn, req, { action: 'update', table: 'salesmen', recordId: id, oldValues: before, newValues: { ...data, code } });
  });
  res.json(await findSalesman(pool, id));
}));

router.delete('/:id', requirePermission('salesmen.delete'), adminApproval('salesmen.delete', { table: 'salesmen', action: 'delete' }, async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const salesman = await findSalesman(conn, id);
    const [[usage]] = await conn.query('SELECT COUNT(*) AS n FROM sales WHERE salesman_id = ?', [id]);
    if (usage.n > 0) {
      throw new HttpError(400, `${salesman.name} has sales recorded and cannot be deleted. Deactivate them instead.`);
    }
    await binRecord(conn, req, 'salesmen', id);
    await conn.query('DELETE FROM salesmen WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'salesmen', recordId: id, oldValues: salesman });
  });
  res.status(204).end();
}));

export default router;
