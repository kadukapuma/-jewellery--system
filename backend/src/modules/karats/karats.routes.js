import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { writeAudit } from '../../utils/audit.js';
import { binRecord } from '../../utils/recycleBin.js';
import { adminApproval } from '../../utils/changeGuard.js';

const router = Router();

const karatSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(10, 'Max 10 characters')
    .transform((v) => v.toUpperCase()),
  purity: z.coerce
    .number({ error: 'Enter purity, e.g. 0.916' })
    .gt(0, 'Purity must be above 0')
    .max(1, 'Purity is a fraction, e.g. 0.916 for 22K'),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  is_active: z.boolean(),
});

function toKarat(row) {
  return { ...row, is_active: !!row.is_active };
}

async function findKarat(db, id) {
  const [rows] = await db.query('SELECT * FROM karats WHERE id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'Karat not found');
  return toKarat(rows[0]);
}

// Price screens need the karat list too.
router.get('/', requirePermission('karats.view', 'gold_prices.view', 'gold_prices.update'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT k.*, (SELECT COUNT(*) FROM gold_prices g WHERE g.karat_id = k.id) AS price_count
     FROM karats k ORDER BY k.sort_order, k.id`,
  );
  res.json(rows.map(toKarat));
});

router.post('/', requirePermission('karats.create'), async (req, res) => {
  const data = karatSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query('INSERT INTO karats (name, purity, sort_order, is_active) VALUES (?, ?, ?, ?)', [
      data.name, data.purity, data.sort_order, data.is_active ? 1 : 0,
    ]);
    await writeAudit(conn, req, { action: 'create', table: 'karats', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findKarat(pool, id));
});

router.put('/:id', requirePermission('karats.edit'), adminApproval('karats.update', { table: 'karats', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const data = karatSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findKarat(conn, id);
    await conn.query('UPDATE karats SET name = ?, purity = ?, sort_order = ?, is_active = ? WHERE id = ?', [
      data.name, data.purity, data.sort_order, data.is_active ? 1 : 0, id,
    ]);
    await writeAudit(conn, req, { action: 'update', table: 'karats', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findKarat(pool, id));
}));

router.delete('/:id', requirePermission('karats.delete'), adminApproval('karats.delete', { table: 'karats', action: 'delete' }, async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const karat = await findKarat(conn, id);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM gold_prices WHERE karat_id = ?', [id]);
    if (n > 0) {
      throw new HttpError(400, `${karat.name} has ${n} saved price(s) and cannot be deleted. Disable it instead.`);
    }
    await binRecord(conn, req, 'karats', id);
    await conn.query('DELETE FROM karats WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'karats', recordId: id, oldValues: karat });
  });
  res.status(204).end();
}));

export default router;
