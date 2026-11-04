import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { dateSchema, gramsSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { getCurrentPrice } from '../gold-prices/gold-prices.service.js';

const router = Router();

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const money = (label) => z.coerce.number({ error: `Enter the ${label}` }).min(0, 'Cannot be negative').max(1e10).default(0);

const issueSchema = z.object({
  craftsman_id: z.coerce.number({ error: 'Choose a craftsman' }).int().positive('Choose a craftsman'),
  category_id: z.coerce.number({ error: 'Choose what is being made' }).int().positive('Choose what is being made'),
  karat_id: z.coerce.number({ error: 'Choose a karat' }).int().positive('Choose a karat'),
  description: optionalText(255),
  issue_date: dateSchema,
  issued_weight_g: gramsSchema('gold weight').refine((v) => v > 0, 'Weight must be above 0'),
  making_charge: money('making charge'),
  craftsman_fee: money('craftsman fee'),
  source_item_id: z.coerce.number().int().positive().optional().nullable(),
});

const editSchema = z.object({
  category_id: z.coerce.number().int().positive('Choose what is being made'),
  description: optionalText(255),
  making_charge: money('making charge'),
  craftsman_fee: money('craftsman fee'),
});

const completeSchema = z.object({
  returned_weight_g: gramsSchema('finished weight').refine((v) => v > 0, 'Weight must be above 0'),
  item_name: z.string().trim().min(1, 'Name the finished item').max(150),
  item_code: optionalText(30),
  making_charge: money('making charge'),
  craftsman_fee: money('craftsman fee'),
  completed_date: dateSchema,
});

const listSchema = z.object({
  status: z.enum(['issued', 'completed', 'cancelled', 'all']).default('issued'),
  craftsman_id: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(50).default(''),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

const JOB_SELECT = `
  SELECT j.*, c.name AS craftsman_name, cat.name AS category_name, k.name AS karat_name,
         src.item_code AS source_item_code, src.name AS source_item_name,
         it.item_code AS finished_item_code, it.barcode AS finished_barcode, it.name AS finished_item_name,
         u.name AS created_by_name,
         DATEDIFF(COALESCE(j.completed_date, CURDATE()), j.issue_date) AS days_out
  FROM craft_jobs j
  JOIN craftsmen c ON c.id = j.craftsman_id
  JOIN categories cat ON cat.id = j.category_id
  JOIN karats k ON k.id = j.karat_id
  LEFT JOIN items src ON src.id = j.source_item_id
  LEFT JOIN items it ON it.id = j.item_id
  JOIN users u ON u.id = j.created_by`;

async function findJob(db, id, lock = false) {
  const [rows] = await db.query(`${JOB_SELECT} WHERE j.id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw new HttpError(404, 'Job not found');
  return rows[0];
}

async function ledger(conn, req, job, type, weight, date, notes = null) {
  if (weight === 0) return;
  await conn.query(
    `INSERT INTO craftsman_gold_ledger (craftsman_id, craft_job_id, karat_id, txn_date, txn_type, weight_g, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [job.craftsman_id, job.id, job.karat_id, date, type, weight, notes, req.user.id],
  );
}

async function moveStock(conn, req, itemId, type, qty, weight, jobId) {
  await conn.query(
    `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
     VALUES (?, ?, ?, ?, 'craft_jobs', ?, ?)`,
    [itemId, type, qty, weight, jobId, req.user.id],
  );
}

router.get('/', requirePermission('craft_jobs.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.status !== 'all') { where.push('j.status = ?'); params.push(q.status); }
  if (q.craftsman_id) { where.push('j.craftsman_id = ?'); params.push(q.craftsman_id); }
  if (q.search) { where.push('(j.job_no LIKE ? OR j.description LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[sums]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(j.issued_weight_g), 0) AS issued_g, COALESCE(SUM(j.wastage_g), 0) AS wastage_g
     FROM craft_jobs j ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(`${JOB_SELECT} ${whereSql} ORDER BY j.issue_date DESC, j.id DESC LIMIT ? OFFSET ?`, [
    ...params, q.page_size, q.page * q.page_size,
  ]);
  res.json({ total: sums.total, sums: { issued_g: Number(sums.issued_g), wastage_g: Number(sums.wastage_g) }, jobs: rows });
});

router.get('/:id', requirePermission('craft_jobs.view'), async (req, res) => {
  res.json(await findJob(pool, parseId(req.params.id)));
});

// Give gold to a craftsman. The gold is loose gold, or one piece / biscuit taken from stock.
router.post('/', requirePermission('craft_jobs.create'), async (req, res) => {
  const data = issueSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [[craftsman]] = await conn.query('SELECT is_active FROM craftsmen WHERE id = ?', [data.craftsman_id]);
    if (!craftsman?.is_active) throw new HttpError(400, 'Choose an active craftsman');
    const [[cat]] = await conn.query('SELECT is_active FROM categories WHERE id = ?', [data.category_id]);
    if (!cat?.is_active) throw new HttpError(400, 'Choose an active category');
    const [[karat]] = await conn.query('SELECT is_active FROM karats WHERE id = ?', [data.karat_id]);
    if (!karat?.is_active) throw new HttpError(400, 'Choose an active karat');

    if (data.source_item_id) {
      const [[src]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [data.source_item_id]);
      if (!src || src.status !== 'in_stock' || src.stock_qty < 1) throw new HttpError(400, 'The gold item is not in stock');
      if (src.karat_id !== data.karat_id) throw new HttpError(400, 'The gold item is a different karat from the job');
      if (data.issued_weight_g > Number(src.net_weight_g)) {
        throw new HttpError(400, `Cannot give more than the item weighs (${Number(src.net_weight_g).toFixed(3)} g)`);
      }
    }

    const jobNo = await nextDocumentNumber(conn, 'JOB');
    const [result] = await conn.query(
      `INSERT INTO craft_jobs (job_no, craftsman_id, category_id, karat_id, source_item_id, description, issued_weight_g,
                               issue_date, making_charge, craftsman_fee, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
      [jobNo, data.craftsman_id, data.category_id, data.karat_id, data.source_item_id ?? null, data.description,
        data.issued_weight_g, data.issue_date, data.making_charge, data.craftsman_fee, req.user.id],
    );
    const job = { id: result.insertId, craftsman_id: data.craftsman_id, karat_id: data.karat_id };

    if (data.source_item_id) {
      // One unit leaves stock; a single piece shows as "with craftsman" until the job ends.
      await conn.query(
        "UPDATE items SET stock_qty = stock_qty - 1, status = IF(stock_qty = 0, 'with_craftsman', status) WHERE id = ?",
        [data.source_item_id],
      );
      await moveStock(conn, req, data.source_item_id, 'craft_issue', -1, -data.issued_weight_g, job.id);
    }
    await ledger(conn, req, job, 'issue', data.issued_weight_g, data.issue_date);
    await writeAudit(conn, req, { action: 'issue', table: 'craft_jobs', recordId: job.id, newValues: { ...data, job_no: jobNo } });
    return job.id;
  });
  res.status(201).json(await findJob(pool, id));
});

router.put('/:id', requirePermission('craft_jobs.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = editSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findJob(conn, id, true);
    if (before.status !== 'issued') throw new HttpError(400, 'Only jobs still with the craftsman can be changed');
    await conn.query('UPDATE craft_jobs SET category_id = ?, description = ?, making_charge = ?, craftsman_fee = ? WHERE id = ?', [
      data.category_id, data.description, data.making_charge, data.craftsman_fee, id,
    ]);
    await writeAudit(conn, req, { action: 'update', table: 'craft_jobs', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findJob(pool, id));
});

// Receive the finished piece. Wastage = gold given - finished weight; the customer pays for all
// the gold given (net + wastage) plus the making charge.
router.post('/:id/complete', requirePermission('craft_jobs.complete'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = completeSchema.parse(req.body);

  const result = await withTransaction(async (conn) => {
    const job = await findJob(conn, id, true);
    if (job.status !== 'issued') throw new HttpError(400, `${job.job_no} is already ${job.status}`);
    const issued = Number(job.issued_weight_g);
    if (data.returned_weight_g > issued) {
      throw new HttpError(400, `The finished piece cannot weigh more than the gold given (${issued.toFixed(3)} g)`);
    }
    if (data.completed_date < String(job.issue_date).slice(0, 10)) throw new HttpError(400, 'Completed date is before the issue date');
    const wastage = round3(issued - data.returned_weight_g);

    // Cost to the shop: the gold (stock cost of the source item, else today's rate) + the craftsman's fee.
    let goldCost = 0;
    if (job.source_item_id) {
      const [[src]] = await conn.query('SELECT cost_price FROM items WHERE id = ?', [job.source_item_id]);
      goldCost = Number(src.cost_price);
    } else {
      const price = await getCurrentPrice(conn, job.karat_id);
      goldCost = price ? round2(issued * Number(price.gram_price)) : 0;
    }

    const barcode = await nextDocumentNumber(conn, 'ITEM');
    const [itemResult] = await conn.query(
      `INSERT INTO items (item_code, barcode, name, category_id, karat_id, source, net_weight_g, wastage_g, making_charge,
                          cost_price, stock_qty, status, description)
       VALUES (?, ?, ?, ?, ?, 'craft', ?, ?, ?, ?, 1, 'in_stock', ?)`,
      [data.item_code || barcode, barcode, data.item_name, job.category_id, job.karat_id, data.returned_weight_g, wastage,
        data.making_charge, round2(goldCost + data.craftsman_fee), `Made in ${job.job_no} by ${job.craftsman_name}`],
    );
    const itemId = itemResult.insertId;

    await conn.query(
      `UPDATE craft_jobs SET returned_weight_g = ?, wastage_g = ?, making_charge = ?, craftsman_fee = ?, completed_date = ?,
                             status = 'completed', item_id = ?
       WHERE id = ?`,
      [data.returned_weight_g, wastage, data.making_charge, data.craftsman_fee, data.completed_date, itemId, id],
    );
    await ledger(conn, req, job, 'return', -data.returned_weight_g, data.completed_date);
    await ledger(conn, req, job, 'wastage', -wastage, data.completed_date);
    await moveStock(conn, req, itemId, 'craft_return', 1, data.returned_weight_g, id);

    if (job.source_item_id) {
      // The source piece was melted into the new one.
      await conn.query("UPDATE items SET status = 'inactive' WHERE id = ? AND stock_qty = 0 AND status = 'with_craftsman'", [job.source_item_id]);
    }
    await writeAudit(conn, req, { action: 'complete', table: 'craft_jobs', recordId: id, newValues: { ...data, wastage_g: wastage, item_id: itemId } });
    return { itemId };
  });

  res.json({ job: await findJob(pool, id), item_id: result.itemId });
});

// The job is called off and the craftsman gives all the gold back.
router.post('/:id/cancel', requirePermission('craft_jobs.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = optionalText(255).parse(req.body?.reason);
  await withTransaction(async (conn) => {
    const job = await findJob(conn, id, true);
    if (job.status !== 'issued') throw new HttpError(400, `${job.job_no} is already ${job.status}`);
    const [[{ today }]] = await conn.query('SELECT CURDATE() AS today');
    await ledger(conn, req, job, 'gold_returned', -Number(job.issued_weight_g), today, reason ? `Job cancelled: ${reason}` : 'Job cancelled');
    if (job.source_item_id) {
      await conn.query("UPDATE items SET stock_qty = stock_qty + 1, status = 'in_stock' WHERE id = ?", [job.source_item_id]);
      await moveStock(conn, req, job.source_item_id, 'adjustment', 1, Number(job.issued_weight_g), id);
    }
    await conn.query("UPDATE craft_jobs SET status = 'cancelled' WHERE id = ?", [id]);
    await writeAudit(conn, req, { action: 'cancel', table: 'craft_jobs', recordId: id, newValues: { reason } });
  });
  res.json(await findJob(pool, id));
});

export default router;
