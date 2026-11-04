import { pool } from '../../config/db.js';
import { getSetting } from '../../utils/settings.js';
import { DEFAULT_GRAMS_PER_POUND, percentChange } from '../../services/pricing.js';

export async function getGramsPerPound() {
  const value = Number(await getSetting('grams_per_pound', DEFAULT_GRAMS_PER_POUND));
  if (!(value > 0)) throw new Error('Setting grams_per_pound must be above 0');
  return value;
}

// Latest price of every active karat (karats without a price come back with nulls),
// plus the previous price for the trend and whether it was entered today.
export async function getCurrentPrices(db = pool) {
  const [rows] = await db.query(
    `SELECT k.id AS karat_id, k.name AS karat, k.purity,
            cur.id AS price_id, cur.pound_price, cur.gram_price, cur.effective_at, cur.notes,
            u.name AS entered_by_name,
            DATE(cur.effective_at) = CURDATE() AS is_today,
            (SELECT g2.pound_price FROM gold_prices g2
             WHERE g2.karat_id = k.id AND g2.id <> cur.id
               AND (g2.effective_at < cur.effective_at OR (g2.effective_at = cur.effective_at AND g2.id < cur.id))
             ORDER BY g2.effective_at DESC, g2.id DESC LIMIT 1) AS previous_pound_price
     FROM karats k
     LEFT JOIN gold_prices cur ON cur.id = (
       SELECT g.id FROM gold_prices g WHERE g.karat_id = k.id ORDER BY g.effective_at DESC, g.id DESC LIMIT 1)
     LEFT JOIN users u ON u.id = cur.entered_by
     WHERE k.is_active = 1
     ORDER BY k.sort_order, k.id`,
  );
  return rows.map((r) => ({
    ...r,
    is_today: !!r.is_today,
    change_percent: r.pound_price === null ? null : percentChange(r.pound_price, r.previous_pound_price),
  }));
}

// Latest price row for one karat - the price a sale uses.
export async function getCurrentPrice(db, karatId) {
  const [rows] = await db.query(
    `SELECT id, karat_id, pound_price, gram_price, effective_at FROM gold_prices
     WHERE karat_id = ? ORDER BY effective_at DESC, id DESC LIMIT 1`,
    [karatId],
  );
  return rows[0] || null;
}
