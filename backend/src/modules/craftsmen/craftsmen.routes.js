import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { dateSchema, gramsSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';

const router = Router();

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

const craftsmanSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  phone: optionalText(30),
  address: optionalText(255),
  opening_gold_g: gramsSchema('opening gold').refine((v) => v >= -100000, 'Too small').default(0),
  opening_cash_balance: z.coerce.number().min(-1e12).max(1e12).default(0),
  is_active: z.boolean(),
});

// Signed: extra_issue adds gold to the craftsman, gold_returned takes it back, adjustment is either way.
const adjustmentSchema = z.object({
  txn_type: z.enum(['extra_issue', 'gold_returned', 'adjustment']),
  karat_id: z.coerce.number({ error: 'Choose a karat' }).int().positive('Choose a karat'),
  weight_g: gramsSchema('weight').refine((v) => v !== 0, 'Weight cannot be 0'),
  txn_date: dateSchema,
  notes: optionalText(255),
});

// gold_held_g = gold the craftsman still has; cash_due > 0 = we owe them, < 0 = advance paid.
const CRAFTSMAN_SELECT = `
  SELECT c.*, b.gold_held_g, b.cash_due,
         (SELECT COUNT(*) FROM craft_jobs j WHERE j.craftsman_id = c.id AND j.status = 'issued') AS open_jobs,
         (SELECT COUNT(*) FROM craft_jobs j WHERE j.craftsman_id = c.id) AS job_count,
         (SELECT COUNT(*) FROM craftsman_payments p WHERE p.craftsman_id = c.id) AS payment_count,
         (SELECT COUNT(*) FROM craftsman_gold_ledger l WHERE l.craftsman_id = c.id) AS ledger_count,
         (SELECT COALESCE(SUM(j.wastage_g), 0) FROM craft_jobs j WHERE j.craftsman_id = c.id AND j.status = 'completed') AS total_wastage_g,
         (SELECT COALESCE(SUM(j.issued_weight_g), 0) FROM craft_jobs j WHERE j.craftsman_id = c.id AND j.status = 'completed') AS completed_issued_g
  FROM craftsmen c JOIN v_craftsman_balances b ON b.craftsman_id = c.id`;

function toCraftsman(row) {
  const issued = Number(row.completed_issued_g);
  return {
    ...row,
    is_active: !!row.is_active,
    gold_held_g: round3(Number(row.gold_held_g)),
    cash_due: round2(Number(row.cash_due)),
    total_wastage_g: round3(Number(row.total_wastage_g)),
    wastage_percent: issued > 0 ? Math.round((Number(row.total_wastage_g) / issued) * 10000) / 100 : null,
  };
}

async function findCraftsman(db, id) {
  const [rows] = await db.query(`${CRAFTSMAN_SELECT} WHERE c.id = ?`, [id]);
  if (!rows.length) throw new HttpError(404, 'Craftsman not found');
  return toCraftsman(rows[0]);
}

router.get('/', requirePermission('craftsmen.view', 'craft_jobs.view', 'craftsman_account.view'), async (req, res) => {
  const [rows] = await pool.query(`${CRAFTSMAN_SELECT} ORDER BY c.name`);
  res.json(rows.map(toCraftsman));
});

router.get('/:id', requirePermission('craftsmen.view', 'craft_jobs.view', 'craftsman_account.view'), async (req, res) => {
  res.json(await findCraftsman(pool, parseId(req.params.id)));
});

// Gold ledger and cash ledger, each with a running balance.
router.get('/:id/account', requirePermission('craftsman_account.view'), async (req, res) => {
  const craftsman = await findCraftsman(pool, parseId(req.params.id));

  const [goldRows] = await pool.query(
    `SELECT l.id, l.txn_date, l.txn_type, l.weight_g, l.notes, l.created_at, k.name AS karat, j.job_no, j.id AS job_id
     FROM craftsman_gold_ledger l
     JOIN karats k ON k.id = l.karat_id
     LEFT JOIN craft_jobs j ON j.id = l.craft_job_id
     WHERE l.craftsman_id = ? ORDER BY l.txn_date, l.id`,
    [craftsman.id],
  );
  let gold = Number(craftsman.opening_gold_g);
  const goldEntries = goldRows.map((r) => {
    gold = round3(gold + Number(r.weight_g));
    return { ...r, weight_g: Number(r.weight_g), balance: gold };
  });

  const [cashRows] = await pool.query(
    `SELECT 'fee' AS type, j.id, j.job_no AS ref, j.description AS detail, j.completed_date AS date, j.craftsman_fee AS amount, j.updated_at AS created_at
     FROM craft_jobs j WHERE j.craftsman_id = ? AND j.status = 'completed' AND j.craftsman_fee > 0
     UNION ALL
     SELECT 'payment', p.id, p.payment_no, CONCAT(p.method, IFNULL(CONCAT(' · ', p.reference_no), '')), p.payment_date, -p.amount, p.created_at
     FROM craftsman_payments p WHERE p.craftsman_id = ? AND p.status = 'active'
     ORDER BY date, created_at`,
    [craftsman.id, craftsman.id],
  );
  let cash = Number(craftsman.opening_cash_balance);
  const cashEntries = cashRows.map((r) => {
    cash = round2(cash + Number(r.amount));
    return { ...r, amount: Number(r.amount), balance: cash };
  });

  res.json({ craftsman, gold: { opening: Number(craftsman.opening_gold_g), entries: goldEntries, closing: gold }, cash: { opening: Number(craftsman.opening_cash_balance), entries: cashEntries, closing: cash } });
});

router.post('/:id/gold-adjustments', requirePermission('craftsman_account.adjust'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = adjustmentSchema.parse(req.body);
  // extra_issue is always +, gold_returned always -, adjustment keeps the sign entered.
  const signed = data.txn_type === 'extra_issue' ? Math.abs(data.weight_g)
    : data.txn_type === 'gold_returned' ? -Math.abs(data.weight_g) : data.weight_g;
  await withTransaction(async (conn) => {
    await findCraftsman(conn, id);
    const [result] = await conn.query(
      `INSERT INTO craftsman_gold_ledger (craftsman_id, karat_id, txn_date, txn_type, weight_g, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.karat_id, data.txn_date, data.txn_type, signed, data.notes, req.user.id],
    );
    await writeAudit(conn, req, { action: 'gold_adjustment', table: 'craftsman_gold_ledger', recordId: result.insertId, newValues: { ...data, weight_g: signed, craftsman_id: id } });
  });
  res.status(201).json(await findCraftsman(pool, id));
});

router.post('/', requirePermission('craftsmen.create'), async (req, res) => {
  const data = craftsmanSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO craftsmen (name, phone, address, opening_gold_g, opening_cash_balance, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
      [data.name, data.phone, data.address, data.opening_gold_g, data.opening_cash_balance, data.is_active ? 1 : 0],
    );
    await writeAudit(conn, req, { action: 'create', table: 'craftsmen', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findCraftsman(pool, id));
});

router.put('/:id', requirePermission('craftsmen.edit'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = craftsmanSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const [[before]] = await conn.query('SELECT * FROM craftsmen WHERE id = ?', [id]);
    if (!before) throw new HttpError(404, 'Craftsman not found');
    await conn.query(
      'UPDATE craftsmen SET name = ?, phone = ?, address = ?, opening_gold_g = ?, opening_cash_balance = ?, is_active = ? WHERE id = ?',
      [data.name, data.phone, data.address, data.opening_gold_g, data.opening_cash_balance, data.is_active ? 1 : 0, id],
    );
    await writeAudit(conn, req, { action: 'update', table: 'craftsmen', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findCraftsman(pool, id));
});

router.delete('/:id', requirePermission('craftsmen.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const c = await findCraftsman(conn, id);
    if (c.job_count || c.payment_count || c.ledger_count) {
      throw new HttpError(400, `${c.name} has jobs or payments and cannot be deleted. Disable instead.`);
    }
    await conn.query('DELETE FROM craftsmen WHERE id = ?', [id]);
    await writeAudit(conn, req, { action: 'delete', table: 'craftsmen', recordId: id, oldValues: c });
  });
  res.status(204).end();
});

export default router;
