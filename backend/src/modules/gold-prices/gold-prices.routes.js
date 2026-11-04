import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { idSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { gramFromPound } from '../../services/pricing.js';
import { getCurrentPrices, getGramsPerPound, getLiveGoldPrice } from './gold-prices.service.js';

const router = Router();

const updateSchema = z.object({
  prices: z
    .array(
      z.object({
        karat_id: idSchema,
        pound_price: z.coerce.number({ error: 'Enter a price' }).positive('Price must be above 0').max(99999999999, 'Price is too large'),
      }),
    )
    .min(1, 'Enter at least one price'),
  notes: optionalText(255),
});

const historySchema = z.object({
  karat_id: z.coerce.number().int().positive().optional(),
  days: z.coerce.number().int().min(1).max(3650).default(30),
});

router.get('/current', requirePermission('gold_prices.view'), async (req, res) => {
  res.json({ grams_per_pound: await getGramsPerPound(), prices: await getCurrentPrices() });
});

router.get('/market', requirePermission('gold_prices.view'), async (req, res) => {
  res.json(await getLiveGoldPrice());
});

router.get('/history', requirePermission('gold_prices.view'), async (req, res) => {
  const { karat_id, days } = historySchema.parse(req.query);
  // LAG runs over the full history so the first row in the window still gets its previous price.
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT gp.id, gp.karat_id, k.name AS karat, gp.pound_price, gp.gram_price, gp.effective_at, gp.notes,
              u.name AS entered_by_name,
              LAG(gp.pound_price) OVER (PARTITION BY gp.karat_id ORDER BY gp.effective_at, gp.id) AS previous_pound_price
       FROM gold_prices gp
       JOIN karats k ON k.id = gp.karat_id
       JOIN users u ON u.id = gp.entered_by
       WHERE (? IS NULL OR gp.karat_id = ?)
     ) t
     WHERE t.effective_at >= NOW() - INTERVAL ? DAY
     ORDER BY t.effective_at DESC, t.id DESC
     LIMIT 1000`,
    [karat_id ?? null, karat_id ?? null, days],
  );
  res.json(rows);
});

// Saves one new price row per karat (history is never overwritten).
router.post('/', requirePermission('gold_prices.update'), async (req, res) => {
  const { prices, notes } = updateSchema.parse(req.body);
  const ids = prices.map((p) => p.karat_id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Each karat can only appear once');

  const gramsPerPound = await getGramsPerPound();

  await withTransaction(async (conn) => {
    const [karats] = await conn.query('SELECT id, name FROM karats WHERE id IN (?) AND is_active = 1', [ids]);
    if (karats.length !== ids.length) throw new HttpError(400, 'One of the karats does not exist or is disabled');

    const [[{ now }]] = await conn.query('SELECT NOW() AS now'); // same timestamp for the whole update
    const rows = prices.map((p) => [p.karat_id, p.pound_price, gramFromPound(p.pound_price, gramsPerPound), now, req.user.id, notes]);
    await conn.query(
      'INSERT INTO gold_prices (karat_id, pound_price, gram_price, effective_at, entered_by, notes) VALUES ?',
      [rows],
    );
    await writeAudit(conn, req, {
      action: 'update_prices',
      table: 'gold_prices',
      newValues: prices.map((p) => ({
        karat: karats.find((k) => k.id === p.karat_id).name,
        pound_price: p.pound_price,
        gram_price: gramFromPound(p.pound_price, gramsPerPound),
      })),
    });
  });

  res.status(201).json({ grams_per_pound: gramsPerPound, prices: await getCurrentPrices() });
});

export default router;
