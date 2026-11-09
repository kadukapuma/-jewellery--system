import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { idSchema } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { adminApproval } from '../../utils/changeGuard.js';
import { getSetting } from '../../utils/settings.js';
import { ITEM_SELECT, presentItem } from '../items/items.service.js';

const router = Router();

export const TAG_FIELDS = ['shop_name', 'barcode', 'item_code', 'name', 'category', 'karat', 'net_weight_g', 'wastage_g'];

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50),
  width_mm: z.coerce.number().min(10, 'At least 10 mm').max(200, 'At most 200 mm'),
  height_mm: z.coerce.number().min(5, 'At least 5 mm').max(200, 'At most 200 mm'),
  barcode_type: z.enum(['CODE128', 'QR']),
  fields: z.array(z.enum(TAG_FIELDS)).min(1, 'Pick at least one thing to print'),
  is_default: z.boolean(),
});

const printSchema = z.object({
  item_ids: z.array(idSchema).min(1, 'Choose at least one item').max(500),
  template_id: idSchema,
  copies: z.coerce.number().int().min(1).max(50).default(1),
});

function toTemplate(row) {
  const fields = typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields;
  return { ...row, fields, is_default: !!row.is_default };
}

async function findTemplate(db, id) {
  const [rows] = await db.query('SELECT * FROM tag_templates WHERE id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'Tag template not found');
  return toTemplate(rows[0]);
}

async function saveTemplate(conn, id, data) {
  if (data.is_default) await conn.query('UPDATE tag_templates SET is_default = 0');
  const values = [data.name, data.width_mm, data.height_mm, data.barcode_type, JSON.stringify(data.fields), data.is_default ? 1 : 0];
  if (id) {
    await conn.query(
      'UPDATE tag_templates SET name = ?, width_mm = ?, height_mm = ?, barcode_type = ?, fields = ?, is_default = ? WHERE id = ?',
      [...values, id],
    );
    return id;
  }
  const [result] = await conn.query(
    'INSERT INTO tag_templates (name, width_mm, height_mm, barcode_type, fields, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    values,
  );
  return result.insertId;
}

router.get('/templates', requirePermission('tags.print', 'tag_templates.edit'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM tag_templates ORDER BY is_default DESC, name');
  res.json({ shop_name: await getSetting('shop_name', 'Jewellery'), fields: TAG_FIELDS, templates: rows.map(toTemplate) });
});

router.post('/templates', requirePermission('tag_templates.edit'), async (req, res) => {
  const data = templateSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const newId = await saveTemplate(conn, null, data);
    await writeAudit(conn, req, { action: 'create', table: 'tag_templates', recordId: newId, newValues: data });
    return newId;
  });
  res.status(201).json(await findTemplate(pool, id));
});

router.put('/templates/:id', requirePermission('tag_templates.edit'), adminApproval('tag_templates.update', { table: 'tag_templates', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const data = templateSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findTemplate(conn, id);
    if (before.is_default && !data.is_default) throw new HttpError(400, 'Make another template the default first');
    await saveTemplate(conn, id, data);
    await writeAudit(conn, req, { action: 'update', table: 'tag_templates', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findTemplate(pool, id));
}));

// Records the print and returns what the browser needs to draw the tags.
router.post('/print', requirePermission('tags.print'), async (req, res) => {
  const { item_ids, template_id, copies } = printSchema.parse(req.body);
  const ids = [...new Set(item_ids)];
  const template = await findTemplate(pool, template_id);

  const [rows] = await pool.query(`${ITEM_SELECT} WHERE i.id IN (?)`, [ids]);
  if (rows.length !== ids.length) throw new HttpError(400, 'Some items were not found');

  await withTransaction(async (conn) => {
    await conn.query('INSERT INTO tag_print_logs (item_id, template_id, copies, printed_by) VALUES ?', [
      ids.map((id) => [id, template_id, copies, req.user.id]),
    ]);
    await conn.query(
      'UPDATE items SET tag_print_count = tag_print_count + ?, last_tag_printed_at = NOW() WHERE id IN (?)',
      [copies, ids],
    );
  });

  const byId = new Map(rows.map((r) => [r.id, presentItem(r, req)]));
  res.json({
    shop_name: await getSetting('shop_name', 'Jewellery'),
    template,
    copies,
    items: ids.map((id) => byId.get(id)), // keep the order the user chose
  });
});

export default router;
