import { Router } from 'express';
import { assertDayOpen } from '../../utils/dayLock.js';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { checkPriceRange, dateSchema, gramsSchema, optionalText, priceRangeFields } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { cancelReason, grams, runCancel, sendCancel } from '../../utils/cancelEffects.js';
import { cancelledRecordRoutes } from '../../utils/cancelledRecords.js';
import { snapshot } from '../../utils/recycleBin.js';
import { adminApproval } from '../../utils/changeGuard.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { getCurrentPrice } from '../gold-prices/gold-prices.service.js';
import { goldHeldOfKarat } from '../craftsmen/craftsmen.gold.js';

const router = Router();

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const money = (label) => z.coerce.number({ error: `Enter the ${label}` }).min(0, 'Cannot be negative').max(1e10).default(0);

// new: make a new piece (becomes a new item). make_item: make a saved item that has no stock yet.
// rework: a saved piece goes to the craftsman (repair / resize / polish) and comes back as the same item.
const issueSchema = z
  .object({
    // rework is only for the shop's own stock pieces; customer items go through Customer Repairs.
    job_type: z.enum(['new', 'make_item', 'rework'], { error: 'Choose make a new piece, make a saved item or repair our item' }).default('new'),
    item_id: z.coerce.number().int().positive().optional().nullable(),
    craftsman_id: z.coerce.number({ error: 'Choose a craftsman' }).int().positive('Choose a craftsman'),
    // Taken from the saved item for make_item / rework.
    category_id: z.coerce.number().int().positive('Choose what is being made').optional().nullable(),
    karat_id: z.coerce.number().int().positive('Choose a karat').optional().nullable(),
    description: optionalText(255),
    issue_date: dateSchema,
    // rework: worked out from the piece's weight + extra gold.
    issued_weight_g: gramsSchema('gold weight').refine((v) => v > 0, 'Weight must be above 0').optional().nullable(),
    extra_weight_g: gramsSchema('extra gold').refine((v) => v >= 0, 'Cannot be negative').default(0),
    // The exact weight wanted for the finished piece (compared with what comes back).
    // false: give all new gold and leave what he already holds untouched.
    use_held_gold: z.boolean().default(true),
    target_weight_g: gramsSchema('piece weight wanted').refine((v) => v > 0, 'Weight must be above 0').optional().nullable(),
    making_charge: money('making charge'),
    craftsman_fee: money('craftsman fee'),
    source_item_id: z.coerce.number().int().positive().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const need = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (data.job_type === 'new') {
      if (!data.category_id) need('category_id', 'Choose what is being made');
      if (!data.karat_id) need('karat_id', 'Choose a karat');
    } else if (!data.item_id) {
      need('item_id', 'Choose the saved item');
    }
    if (data.job_type !== 'rework' && !data.issued_weight_g) need('issued_weight_g', 'Enter the gold weight');
    if (data.job_type === 'rework' && data.source_item_id) need('source_item_id', 'Extra gold for a repair is loose gold');
  });

const editSchema = z.object({
  category_id: z.coerce.number().int().positive('Choose what is being made'),
  description: optionalText(255),
  making_charge: money('making charge'),
  craftsman_fee: money('craftsman fee'),
});

const completeSchema = z
  .object({
    returned_weight_g: gramsSchema('finished weight').refine((v) => v > 0, 'Weight must be above 0'),
    // Only for a new piece; make_item / rework jobs fill in the saved item.
    item_name: z.string().trim().max(150).optional().nullable(),
    item_code: optionalText(30),
    making_charge: money('making charge'),
    ...priceRangeFields,
    craftsman_fee: money('craftsman fee'),
    completed_date: dateSchema,
  })
  .superRefine((data, ctx) => checkPriceRange(data, ctx));

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
         it.wastage_g AS item_wastage_g, it.making_charge AS item_making_charge,
         it.stock_qty AS item_stock_qty, it.net_weight_g AS item_net_weight_g,
         it.price_min_percent AS item_price_min_percent, it.price_max_percent AS item_price_max_percent,
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

// The saved item a make_item / rework job is for. Checked and locked inside the transaction.
async function lockSavedItem(conn, data) {
  const [[item]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [data.item_id]);
  if (!item) throw new HttpError(400, 'Saved item not found');
  // Making more of an item can run as several jobs at once, but never while the piece is out for a rework;
  // a rework needs the item to be on no other open job.
  const [[open]] = await conn.query(
    `SELECT job_no FROM craft_jobs WHERE item_id = ? AND status = 'issued' ${data.job_type === 'make_item' ? "AND job_type = 'rework'" : ''} LIMIT 1`,
    [item.id],
  );
  if (open) throw new HttpError(400, `${item.item_code} is ${data.job_type === 'make_item' ? 'out for a repair on' : 'already on'} job ${open.job_no}`);
  if (data.job_type === 'rework') {
    if (item.status !== 'in_stock' || item.stock_qty < 1) throw new HttpError(400, `${item.item_code} is not in stock`);
    if (item.stock_qty > 1) throw new HttpError(400, `${item.item_code} has ${item.stock_qty} pieces. Only single pieces can be reworked.`);
  }
  return item;
}

// Give gold to a craftsman. The gold is loose gold, or one piece / biscuit taken from stock.
// For a rework the saved piece itself (plus any extra loose gold) is what is given.
router.post('/', requirePermission('craft_jobs.create'), async (req, res) => {
  const data = issueSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    await assertDayOpen(conn, data.issue_date);
    // Locked so two jobs cannot use the same held gold at once.
    const [[craftsman]] = await conn.query('SELECT is_active FROM craftsmen WHERE id = ? FOR UPDATE', [data.craftsman_id]);
    if (!craftsman?.is_active) throw new HttpError(400, 'Choose an active craftsman');

    let saved = null;
    if (data.job_type !== 'new') {
      saved = await lockSavedItem(conn, data);
      data.category_id = saved.category_id;
      data.karat_id = saved.karat_id;
      data.description = data.description || saved.name;
      if (data.job_type === 'rework') data.issued_weight_g = round3(Number(saved.net_weight_g) + data.extra_weight_g);
    } else {
      const [[cat]] = await conn.query('SELECT is_active FROM categories WHERE id = ?', [data.category_id]);
      if (!cat?.is_active) throw new HttpError(400, 'Choose an active category');
    }
    const [[karat]] = await conn.query('SELECT is_active FROM karats WHERE id = ?', [data.karat_id]);
    if (!karat?.is_active) throw new HttpError(400, 'Choose an active karat');

    // Gold he already holds of the job's karat is always used first; only the rest is new gold.
    // For a rework only the extra gold can come from it; the piece is the shop's.
    const loose = data.job_type === 'rework' ? data.extra_weight_g : data.issued_weight_g;
    const has = data.use_held_gold ? Math.max(0, await goldHeldOfKarat(conn, data.craftsman_id, data.karat_id)) : 0;
    const held = round3(Math.min(has, loose));

    if (data.target_weight_g && data.target_weight_g > data.issued_weight_g) {
      throw new HttpError(400, `The piece cannot weigh more than the gold for the job (${Number(data.issued_weight_g).toFixed(3)} g)`);
    }

    if (data.source_item_id) {
      if (data.source_item_id === saved?.id) throw new HttpError(400, 'The gold cannot come from the item being made');
      const [[src]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [data.source_item_id]);
      if (!src || src.status !== 'in_stock' || src.stock_qty < 1) throw new HttpError(400, 'The gold item is not in stock');
      if (src.karat_id !== data.karat_id) throw new HttpError(400, 'The gold item is a different karat from the job');
      // Only the new gold comes from the item; the rest is gold he already has.
      const fromItem = round3(data.issued_weight_g - held);
      if (fromItem <= 0) throw new HttpError(400, 'He already has enough gold for this job; no gold from stock is needed');
      if (fromItem > Number(src.net_weight_g)) {
        throw new HttpError(400, `Cannot take more than the item weighs (${Number(src.net_weight_g).toFixed(3)} g)`);
      }
    }

    const jobNo = await nextDocumentNumber(conn, 'JOB');
    const [result] = await conn.query(
      `INSERT INTO craft_jobs (job_no, job_type, craftsman_id, category_id, karat_id, source_item_id, item_id, description, target_weight_g,
                               issued_weight_g, held_gold_g, item_weight_g, issue_date, making_charge, craftsman_fee, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
      [jobNo, data.job_type, data.craftsman_id, data.category_id, data.karat_id, data.source_item_id ?? null, saved?.id ?? null,
        data.description, data.target_weight_g ?? null, data.issued_weight_g, held, data.job_type === 'rework' ? Number(saved.net_weight_g) : null,
        data.issue_date, data.making_charge, data.craftsman_fee, req.user.id],
    );
    const job = { id: result.insertId, craftsman_id: data.craftsman_id, karat_id: data.karat_id };

    if (data.job_type === 'rework') {
      // The piece itself leaves stock until it comes back.
      await conn.query("UPDATE items SET stock_qty = 0, status = 'with_craftsman' WHERE id = ?", [saved.id]);
      await moveStock(conn, req, saved.id, 'craft_issue', -1, -Number(saved.net_weight_g), job.id);
    }
    // make_item: nothing leaves stock and the item stays as it is (pieces already in stock can still be sold).

    if (data.source_item_id) {
      // One unit leaves stock; a single piece shows as "with craftsman" until the job ends.
      await conn.query(
        "UPDATE items SET stock_qty = stock_qty - 1, status = IF(stock_qty = 0, 'with_craftsman', status) WHERE id = ?",
        [data.source_item_id],
      );
      await moveStock(conn, req, data.source_item_id, 'craft_issue', -1, -round3(data.issued_weight_g - held), job.id);
    }
    await ledger(conn, req, job, 'issue', data.issued_weight_g, data.issue_date);
    // Gold he already had goes into this job, so it comes off his free balance.
    await ledger(conn, req, job, 'held_used', -held, data.issue_date, 'Gold he already had');
    await writeAudit(conn, req, { action: 'issue', table: 'craft_jobs', recordId: job.id, newValues: { ...data, job_no: jobNo } });
    return job.id;
  });
  res.status(201).json(await findJob(pool, id));
});

router.put('/:id', requirePermission('craft_jobs.edit'), adminApproval('craft_jobs.update', { table: 'craft_jobs', action: 'update' }, async (req, res) => {
  const id = parseId(req.params.id);
  const data = editSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findJob(conn, id, true);
    if (before.status !== 'issued') throw new HttpError(400, 'Only jobs still with the craftsman can be changed');
    // A job for a saved item keeps that item's category.
    if (before.job_type !== 'new') data.category_id = before.category_id;
    await conn.query('UPDATE craft_jobs SET category_id = ?, description = ?, making_charge = ?, craftsman_fee = ? WHERE id = ?', [
      data.category_id, data.description, data.making_charge, data.craftsman_fee, id,
    ]);
    await writeAudit(conn, req, { action: 'update', table: 'craft_jobs', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findJob(pool, id));
}));

// Receive the finished piece. Wastage = gold given - finished weight; the customer pays for all
// the gold given (net + wastage) plus the making charge.
router.post('/:id/complete', requirePermission('craft_jobs.complete'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = completeSchema.parse(req.body);

  const result = await withTransaction(async (conn) => {
    const job = await findJob(conn, id, true);
    if (job.status !== 'issued') throw new HttpError(400, `${job.job_no} is already ${job.status}`);
    await assertDayOpen(conn, data.completed_date);
    const issued = Number(job.issued_weight_g);
    if (data.returned_weight_g > issued) {
      throw new HttpError(400, `The finished piece cannot weigh more than the gold given (${issued.toFixed(3)} g)`);
    }
    if (data.completed_date < String(job.issue_date).slice(0, 10)) throw new HttpError(400, 'Completed date is before the issue date');
    if (job.job_type === 'new' && !data.item_name) throw new HttpError(400, 'Name the finished item');
    const wastage = round3(issued - data.returned_weight_g);

    // Cost to the shop: the gold (stock cost of the source item, else today's rate) + the craftsman's fee.
    // A rework only adds the extra gold given on top of the piece.
    const looseGold = job.job_type === 'rework' ? issued - Number(job.item_weight_g) : issued;
    let goldCost = 0;
    if (job.source_item_id) {
      const [[src]] = await conn.query('SELECT cost_price FROM items WHERE id = ?', [job.source_item_id]);
      goldCost = Number(src.cost_price);
    } else if (looseGold > 0) {
      const price = await getCurrentPrice(conn, job.karat_id);
      goldCost = price ? round2(looseGold * Number(price.gram_price)) : 0;
    }

    let itemId = job.item_id;
    if (job.job_type === 'new') {
      const barcode = await nextDocumentNumber(conn, 'ITEM');
      const [itemResult] = await conn.query(
        `INSERT INTO items (item_code, barcode, name, category_id, karat_id, source, net_weight_g, wastage_g, making_charge,
                            price_min_percent, price_max_percent, cost_price, stock_qty, status, description)
         VALUES (?, ?, ?, ?, ?, 'craft', ?, ?, ?, ?, ?, ?, 1, 'in_stock', ?)`,
        [data.item_code || barcode, barcode, data.item_name, job.category_id, job.karat_id, data.returned_weight_g, wastage,
          data.making_charge, data.price_min_percent, data.price_max_percent, round2(goldCost + data.craftsman_fee),
          `Made in ${job.job_no} by ${job.craftsman_name}`],
      );
      itemId = itemResult.insertId;
    } else if (job.job_type === 'make_item') {
      const [[target]] = await conn.query('SELECT stock_qty, cost_price FROM items WHERE id = ? FOR UPDATE', [itemId]);
      const pieceCost = round2(goldCost + data.craftsman_fee);
      if (target.stock_qty === 0) {
        // First piece: the saved item gets its real weight, wastage and cost and comes into stock.
        await conn.query(
          `UPDATE items SET net_weight_g = ?, wastage_g = ?, making_charge = ?, price_min_percent = ?, price_max_percent = ?,
                            cost_price = ?, stock_qty = 1, status = 'in_stock'
           WHERE id = ?`,
          [data.returned_weight_g, wastage, data.making_charge, data.price_min_percent, data.price_max_percent, pieceCost, itemId],
        );
      } else {
        // One more piece of an item already in stock. The line keeps its weight and price per piece
        // (the actual weight and wastage stay on the job); cost becomes the average of all pieces.
        const avgCost = round2((Number(target.cost_price) * target.stock_qty + pieceCost) / (target.stock_qty + 1));
        await conn.query("UPDATE items SET stock_qty = stock_qty + 1, cost_price = ?, status = 'in_stock' WHERE id = ?", [avgCost, itemId]);
      }
    } else {
      // Rework: the same piece comes back. The customer still pays for all the gold it ever used,
      // so this job's wastage and making are added to what the piece already had.
      await conn.query(
        `UPDATE items SET net_weight_g = ?, wastage_g = wastage_g + ?, making_charge = making_charge + ?,
                          price_min_percent = ?, price_max_percent = ?, cost_price = cost_price + ?,
                          stock_qty = 1, status = 'in_stock'
         WHERE id = ?`,
        [data.returned_weight_g, wastage, data.making_charge, data.price_min_percent, data.price_max_percent,
          round2(goldCost + data.craftsman_fee), itemId],
      );
    }

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
  const reason = cancelReason(req);
  const outcome = await runCancel(req, { table: 'craft_jobs', recordId: id }, async (conn, fx) => {
    const job = await findJob(conn, id, true);
    if (job.status !== 'issued') throw new HttpError(400, `${job.job_no} is already ${job.status}`);
    const [[{ today }]] = await conn.query('SELECT CURDATE() AS today');
    await assertDayOpen(conn, today);
    await fx.watchCraftsman(conn, job.craftsman_id);
    fx.add('craftsman', `Get the ${grams(job.issued_weight_g)} of gold given for ${job.job_no} back from the craftsman`, '/craftsmen');
    await ledger(conn, req, job, 'gold_returned', -Number(job.issued_weight_g), today, reason ? `Job cancelled: ${reason}` : 'Job cancelled');
    // Gold he already had stays with him, back on his balance.
    const held = Number(job.held_gold_g);
    await ledger(conn, req, job, 'held_used', held, today, 'Job cancelled: held gold back on balance');
    const itemName = async (itemId) => {
      const [[i]] = await conn.query('SELECT item_code, name FROM items WHERE id = ?', [itemId]);
      return i ? `${i.item_code} ${i.name}` : 'The item';
    };
    if (job.source_item_id) {
      await conn.query("UPDATE items SET stock_qty = stock_qty + 1, status = 'in_stock' WHERE id = ?", [job.source_item_id]);
      await moveStock(conn, req, job.source_item_id, 'adjustment', 1, round3(Number(job.issued_weight_g) - held), id);
      fx.add('stock', `${await itemName(job.source_item_id)} (the gold given from stock) goes back into stock`, '/items');
    }
    if (job.job_type === 'rework') {
      // The piece comes back as it was.
      await conn.query("UPDATE items SET stock_qty = 1, status = 'in_stock' WHERE id = ?", [job.item_id]);
      await moveStock(conn, req, job.item_id, 'adjustment', 1, Number(job.item_weight_g), id);
      fx.add('stock', `${await itemName(job.item_id)} goes back into stock as it was`, '/items');
    } else if (job.job_type === 'make_item') {
      // Jobs given before items stayed as they are marked the item "with craftsman"; free it again.
      const [r] = await conn.query("UPDATE items SET status = 'in_stock' WHERE id = ? AND status = 'with_craftsman'", [job.item_id]);
      if (r.affectedRows) fx.add('stock', `${await itemName(job.item_id)} is no longer marked "with craftsman"`, '/items');
    }
    await conn.query("UPDATE craft_jobs SET status = 'cancelled' WHERE id = ?", [id]);
    await writeAudit(conn, req, { action: 'cancel', table: 'craft_jobs', recordId: id, newValues: { reason } });
  });
  await sendCancel(res, outcome, () => findJob(pool, id));
});

// A cancelled job can be deleted with its gold entries, as long as they cancel each other out
// (issue + gold returned) and no craftsman payment points at it.
cancelledRecordRoutes(router, {
  table: 'craft_jobs',
  module: 'craft_jobs',
  children: async (conn, job) => {
    const ledgerRows = await snapshot(conn, 'craftsman_gold_ledger', 'craft_job_id = ?', [job.id]);
    const held = ledgerRows.reduce((sum, r) => sum + Number(r.weight_g), 0);
    if (Math.abs(held) > 0.0005) throw new HttpError(400, `${job.job_no} still changes the craftsman's gold balance and cannot be deleted.`);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM craftsman_payments WHERE craft_job_id = ?', [job.id]);
    if (n > 0) throw new HttpError(400, `${job.job_no} has craftsman payments. Delete those first.`);
    return [{ table: 'craftsman_gold_ledger', rows: ledgerRows }];
  },
});

export default router;
