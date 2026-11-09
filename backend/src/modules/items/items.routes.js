import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { hasPermission, requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { checkPriceRange, dateSchema, gramsSchema as grams, optionalText, priceRangeFields } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { moveToBin, snapshot } from '../../utils/recycleBin.js';
import { adminApproval } from '../../utils/changeGuard.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { ITEM_SELECT, findItem, presentItem } from './items.service.js';

const router = Router();

const itemFields = {
  name: z.string().trim().min(1, 'Name is required').max(150),
  category_id: z.coerce.number({ error: 'Choose a category' }).int().positive('Choose a category'),
  karat_id: z.coerce.number({ error: 'Choose a karat' }).int().positive('Choose a karat'),
  net_weight_g: grams('weight').refine((v) => v > 0, 'Weight must be above 0'),
  wastage_g: grams('wastage').refine((v) => v >= 0, 'Cannot be negative').default(0),
  making_charge: z.coerce.number().min(0, 'Cannot be negative').max(1e10).default(0),
  ...priceRangeFields,
  cost_price: z.coerce.number().min(0, 'Cannot be negative').max(1e12).optional(),
  stock_qty: z.coerce.number().int('Whole number only').min(0, 'Cannot be negative').max(100000).default(1),
  description: optionalText(255),
};

const rangeRule = (data, ctx) => checkPriceRange(data, ctx);

const createSchema = z.object({ ...itemFields, item_code: optionalText(30) }).superRefine(rangeRule);
const updateSchema = z
  .object({
    ...itemFields,
    item_code: z.string().trim().min(1, 'Code is required').max(30),
    status: z.enum(['in_stock', 'inactive']),
  })
  .superRefine(rangeRule);

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  category_id: z.coerce.number().int().positive().optional(),
  karat_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['in_stock', 'sold', 'with_craftsman', 'inactive', 'all']).default('in_stock'),
  // available = has pieces in stock, empty = saved but none in stock yet (e.g. to be made by a craftsman)
  stock: z.enum(['any', 'available', 'empty']).default('any'),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

// Why stock was added or taken out by hand.
const STOCK_REASONS = ['received', 'returned', 'found', 'count_correction', 'damaged', 'lost', 'other'];

const stockSchema = z.object({
  direction: z.enum(['in', 'out']),
  qty: z.coerce.number().int('Whole number only').min(1, 'At least 1').max(100000),
  reason: z.enum(STOCK_REASONS, { error: 'Choose a reason' }),
  note: optionalText(255),
});

const movementListSchema = z.object({
  search: z.string().trim().max(100).default(''),
  item_id: z.coerce.number().int().positive().optional(),
  movement_type: z.enum(['purchase', 'sale', 'craft_issue', 'craft_return', 'adjustment', 'all']).default('all'),
  direction: z.enum(['in', 'out', 'all']).default('all'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(500).default(50),
});

// Movement + item, who did it and the bill / purchase / job number it came from.
const MOVEMENT_SELECT = `
  SELECT sm.*, i.item_code, i.barcode, i.name AS item_name, k.name AS karat_name, u.name AS created_by_name,
         COALESCE(s.invoice_no, p.purchase_no, j.job_no) AS ref_no,
         EXISTS (SELECT 1 FROM stock_movements r WHERE r.ref_table = 'stock_movements' AND r.ref_id = sm.id) AS reversed
  FROM stock_movements sm
  JOIN items i ON i.id = sm.item_id
  JOIN karats k ON k.id = i.karat_id
  JOIN users u ON u.id = sm.created_by
  LEFT JOIN sales s ON sm.ref_table = 'sales' AND s.id = sm.ref_id
  LEFT JOIN purchases p ON sm.ref_table = 'purchases' AND p.id = sm.ref_id
  LEFT JOIN craft_jobs j ON sm.ref_table = 'craft_jobs' AND j.id = sm.ref_id`;

async function checkCategoryAndKarat(conn, categoryId, karatId) {
  const [[cat]] = await conn.query('SELECT is_active FROM categories WHERE id = ?', [categoryId]);
  if (!cat?.is_active) throw new HttpError(400, 'Choose an active category');
  const [[karat]] = await conn.query('SELECT is_active FROM karats WHERE id = ?', [karatId]);
  if (!karat?.is_active) throw new HttpError(400, 'Choose an active karat');
}

async function logStock(conn, req, itemId, qtyChange, weightPerUnit) {
  if (qtyChange === 0) return;
  await conn.query(
    `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
     VALUES (?, 'adjustment', ?, ?, 'items', ?, ?)`,
    [itemId, qtyChange, Math.round(qtyChange * weightPerUnit * 1000) / 1000, itemId, req.user.id],
  );
}

router.get('/', requirePermission('items.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) {
    where.push('(i.barcode = ? OR i.item_code LIKE ? OR i.name LIKE ?)');
    params.push(q.search, `%${q.search}%`, `%${q.search}%`);
  }
  if (q.category_id) { where.push('i.category_id = ?'); params.push(q.category_id); }
  if (q.karat_id) { where.push('i.karat_id = ?'); params.push(q.karat_id); }
  if (q.status !== 'all') { where.push('i.status = ?'); params.push(q.status); }
  if (q.stock === 'available') where.push('i.stock_qty > 0');
  if (q.stock === 'empty') where.push('i.stock_qty = 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM items i ${whereSql}`, params);
  const [rows] = await pool.query(`${ITEM_SELECT} ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({ total, items: rows.map((r) => presentItem(r, req)) });
});

// Totals for everything currently in stock, valued at today's prices.
router.get('/summary', requirePermission('items.view'), async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS item_lines,
            COALESCE(SUM(i.stock_qty), 0) AS pieces,
            COALESCE(SUM(i.net_weight_g * i.stock_qty), 0) AS gold_weight_g,
            COALESCE(SUM(((i.net_weight_g + i.wastage_g) * cp.gram_price + i.making_charge) * i.stock_qty), 0) AS value_now,
            SUM(cp.gram_price IS NULL) AS without_price
     FROM items i LEFT JOIN v_current_gold_prices cp ON cp.karat_id = i.karat_id
     WHERE i.status = 'in_stock' AND i.stock_qty > 0`,
  );
  res.json({
    item_lines: row.item_lines,
    pieces: Number(row.pieces),
    gold_weight_g: Math.round(Number(row.gold_weight_g) * 1000) / 1000,
    value_now: Math.round(Number(row.value_now) * 100) / 100,
    without_price: Number(row.without_price || 0),
  });
});

// Scanner / POS lookup by barcode or item code.
router.get('/lookup/:code', requirePermission('items.view'), async (req, res) => {
  const code = String(req.params.code).trim();
  const [rows] = await pool.query(`${ITEM_SELECT} WHERE i.barcode = ? OR i.item_code = ? LIMIT 1`, [code, code]);
  if (!rows.length) throw new HttpError(404, `No item with code ${code}`);
  res.json(presentItem(rows[0], req));
});

// Every stock change in the shop (purchases, sales, craft jobs and hand entries), newest first.
router.get('/stock-movements', requirePermission('items.view'), async (req, res) => {
  const q = movementListSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) {
    where.push('(i.barcode = ? OR i.item_code LIKE ? OR i.name LIKE ?)');
    params.push(q.search, `%${q.search}%`, `%${q.search}%`);
  }
  if (q.item_id) { where.push('sm.item_id = ?'); params.push(q.item_id); }
  if (q.movement_type !== 'all') { where.push('sm.movement_type = ?'); params.push(q.movement_type); }
  if (q.direction === 'in') where.push('sm.qty_change > 0');
  if (q.direction === 'out') where.push('sm.qty_change < 0');
  if (q.from) { where.push('sm.created_at >= ?'); params.push(q.from); }
  if (q.to) { where.push('sm.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[sums]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(GREATEST(sm.qty_change, 0)), 0) AS qty_in, COALESCE(SUM(LEAST(sm.qty_change, 0)), 0) AS qty_out,
            COALESCE(SUM(GREATEST(sm.weight_change_g, 0)), 0) AS weight_in, COALESCE(SUM(LEAST(sm.weight_change_g, 0)), 0) AS weight_out
     FROM stock_movements sm JOIN items i ON i.id = sm.item_id ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(`${MOVEMENT_SELECT} ${whereSql} ORDER BY sm.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({
    total: sums.total,
    sums: {
      qty_in: Number(sums.qty_in),
      qty_out: -Number(sums.qty_out),
      weight_in: Math.round(Number(sums.weight_in) * 1000) / 1000,
      weight_out: -Math.round(Number(sums.weight_out) * 1000) / 1000,
    },
    movements: rows,
  });
});

router.get('/:id', requirePermission('items.view'), async (req, res) => {
  res.json(await findItem(pool, parseId(req.params.id), req));
});

// One item's stock history, newest first, with the quantity left after each change.
router.get('/:id/stock', requirePermission('items.view'), async (req, res) => {
  const item = await findItem(pool, parseId(req.params.id), req);
  const [rows] = await pool.query(`${MOVEMENT_SELECT} WHERE sm.item_id = ? ORDER BY sm.id DESC`, [item.id]);
  // Walk back from today's quantity, so the balance always ends on what is really in stock.
  let after = item.stock_qty;
  const movements = rows.map((m) => {
    const row = { ...m, qty_after: after };
    after -= m.qty_change;
    return row;
  });
  res.json({ item, movements });
});

// Add stock (new pieces received, returned, found) or take it out (damaged, lost, count correction).
router.post('/:id/stock', requirePermission('items.adjust_stock'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = stockSchema.parse(req.body);

  await withTransaction(async (conn) => {
    const [[item]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [id]);
    if (!item) throw new HttpError(404, 'Item not found');
    if (item.status === 'with_craftsman') throw new HttpError(400, 'This item is with a craftsman. Receive it back first.');
    const change = data.direction === 'in' ? data.qty : -data.qty;
    if (item.stock_qty + change < 0) throw new HttpError(400, `Only ${item.stock_qty} of ${item.item_code} in stock`);

    // A sold-out line goes back on sale when new stock comes in.
    const status = change > 0 && item.status === 'sold' ? 'in_stock' : item.status;
    await conn.query('UPDATE items SET stock_qty = stock_qty + ?, status = ? WHERE id = ?', [change, status, id]);
    await conn.query(
      `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, reason, note, created_by)
       VALUES (?, 'adjustment', ?, ?, 'items', ?, ?, ?, ?)`,
      [id, change, Math.round(change * Number(item.net_weight_g) * 1000) / 1000, id, data.reason, data.note, req.user.id],
    );
    await writeAudit(conn, req, {
      action: 'stock_adjust',
      table: 'items',
      recordId: id,
      oldValues: { stock_qty: item.stock_qty, status: item.status },
      newValues: { stock_qty: item.stock_qty + change, status, reason: data.reason, note: data.note },
    });
  });
  res.status(201).json(await findItem(pool, id, req));
});

// Stock history is never deleted. A wrong manual adjustment is undone by an opposite entry.
router.post('/stock-movements/:id/reverse', requirePermission('items.reverse_stock'), adminApproval('items.reverse_stock', { table: 'stock_movements', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const itemId = await withTransaction(async (conn) => {
    const [[m]] = await conn.query('SELECT * FROM stock_movements WHERE id = ? FOR UPDATE', [id]);
    if (!m) throw new HttpError(404, 'Stock entry not found');
    if (m.movement_type !== 'adjustment' || m.ref_table !== 'items' || !m.reason) {
      throw new HttpError(400, 'Only manual stock adjustments can be reversed. Purchases, bills and craft jobs are undone by cancelling them.');
    }
    const [[done]] = await conn.query("SELECT id FROM stock_movements WHERE ref_table = 'stock_movements' AND ref_id = ?", [id]);
    if (done) throw new HttpError(400, 'This adjustment was already reversed');
    const [[item]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [m.item_id]);
    if (item.status === 'with_craftsman') throw new HttpError(400, 'This item is with a craftsman. Receive it back first.');
    const qty = item.stock_qty - m.qty_change;
    if (qty < 0) throw new HttpError(400, `Only ${item.stock_qty} of ${item.item_code} in stock, so this cannot be reversed`);
    const status = qty > 0 && item.status === 'sold' ? 'in_stock' : item.status;
    await conn.query('UPDATE items SET stock_qty = ?, status = ? WHERE id = ?', [qty, status, item.id]);
    await conn.query(
      `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, reason, note, created_by)
       VALUES (?, 'adjustment', ?, ?, 'stock_movements', ?, 'reversal', ?, ?)`,
      [item.id, -m.qty_change, -Number(m.weight_change_g), id, `Reverses entry #${id}`, req.user.id],
    );
    await writeAudit(conn, req, {
      action: 'stock_reverse',
      table: 'items',
      recordId: item.id,
      oldValues: { stock_qty: item.stock_qty, movement_id: id, qty_change: m.qty_change },
      newValues: { stock_qty: qty, status },
    });
    return item.id;
  });
  res.status(201).json(await findItem(pool, itemId, req));
}));

// Items entered here are opening stock; purchases and craft jobs create their own items later.
router.post('/', requirePermission('items.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const costPrice = hasPermission(req, 'items.view_cost') ? data.cost_price ?? 0 : 0;

  const id = await withTransaction(async (conn) => {
    await checkCategoryAndKarat(conn, data.category_id, data.karat_id);
    const barcode = await nextDocumentNumber(conn, 'ITEM');
    const [result] = await conn.query(
      `INSERT INTO items (item_code, barcode, name, category_id, karat_id, source, net_weight_g, wastage_g,
                          making_charge, price_min_percent, price_max_percent, cost_price, stock_qty, status, description)
       VALUES (?, ?, ?, ?, ?, 'opening', ?, ?, ?, ?, ?, ?, ?, 'in_stock', ?)`,
      [data.item_code || barcode, barcode, data.name, data.category_id, data.karat_id, data.net_weight_g, data.wastage_g,
        data.making_charge, data.price_min_percent, data.price_max_percent, costPrice, data.stock_qty, data.description],
    );
    await logStock(conn, req, result.insertId, data.stock_qty, data.net_weight_g);
    await writeAudit(conn, req, { action: 'create', table: 'items', recordId: result.insertId, newValues: { ...data, barcode } });
    return result.insertId;
  });
  res.status(201).json(await findItem(pool, id, req));
});

router.put('/:id', requirePermission('items.edit'), adminApproval('items.update', { table: 'items', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const data = updateSchema.parse(req.body);

  await withTransaction(async (conn) => {
    const [[before]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [id]);
    if (!before) throw new HttpError(404, 'Item not found');
    if (before.status === 'sold') throw new HttpError(400, 'Sold items cannot be changed');
    if (before.status === 'with_craftsman') throw new HttpError(400, 'This item is with a craftsman and cannot be changed');
    await checkCategoryAndKarat(conn, data.category_id, data.karat_id);

    const costPrice = hasPermission(req, 'items.view_cost') ? data.cost_price ?? before.cost_price : before.cost_price;
    await conn.query(
      `UPDATE items SET item_code = ?, name = ?, category_id = ?, karat_id = ?, net_weight_g = ?, wastage_g = ?,
                        making_charge = ?, price_min_percent = ?, price_max_percent = ?, cost_price = ?, stock_qty = ?,
                        status = ?, description = ?
       WHERE id = ?`,
      [data.item_code, data.name, data.category_id, data.karat_id, data.net_weight_g, data.wastage_g, data.making_charge,
        data.price_min_percent, data.price_max_percent, costPrice, data.stock_qty, data.status, data.description, id],
    );
    await logStock(conn, req, id, data.stock_qty - before.stock_qty, data.net_weight_g);
    const { cost_price: _oldCost, ...oldLogged } = before;
    const { cost_price: _newCost, ...newLogged } = data;
    await writeAudit(conn, req, { action: 'update', table: 'items', recordId: id, oldValues: oldLogged, newValues: newLogged });
  });
  res.json(await findItem(pool, id, req));
}));

// Only items with no purchase, sale or craft history can be removed; others are marked Inactive.
router.delete('/:id', requirePermission('items.delete'), adminApproval('items.delete', { table: 'items', action: 'delete' }, async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const [[item]] = await conn.query('SELECT id, item_code, name FROM items WHERE id = ? FOR UPDATE', [id]);
    if (!item) throw new HttpError(404, 'Item not found');
    const [[usage]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM purchase_lines WHERE item_id = ?) +
              (SELECT COUNT(*) FROM sale_lines WHERE item_id = ?) +
              (SELECT COUNT(*) FROM craft_jobs WHERE item_id = ? OR source_item_id = ?) AS n`,
      [id, id, id, id],
    );
    if (usage.n > 0) throw new HttpError(400, `${item.item_code} has purchase, sale or craft history. Mark it Inactive instead.`);
    await moveToBin(conn, req, {
      table: 'items',
      recordId: id,
      label: item.item_code,
      parts: [
        { table: 'items', rows: await snapshot(conn, 'items', 'id = ?', [id]) },
        { table: 'stock_movements', rows: await snapshot(conn, 'stock_movements', 'item_id = ?', [id]) },
        { table: 'tag_print_logs', rows: await snapshot(conn, 'tag_print_logs', 'item_id = ?', [id]) },
      ],
    });
    await conn.query('DELETE FROM tag_print_logs WHERE item_id = ?', [id]);
    await conn.query('DELETE FROM stock_movements WHERE item_id = ?', [id]);
    await conn.query('DELETE FROM items WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'items', recordId: id, oldValues: item });
  });
  res.status(204).end();
}));

export default router;
