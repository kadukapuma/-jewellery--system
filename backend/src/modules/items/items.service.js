import { hasPermission } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { calcItemPrice, calcPriceRange } from '../../services/pricing.js';

// Item + category, karat and today's gram price for its karat.
export const ITEM_SELECT = `
  SELECT i.*, c.name AS category_name, c.category_type, k.name AS karat_name,
         cp.gram_price AS current_gram_price
  FROM items i
  JOIN categories c ON c.id = i.category_id
  JOIN karats k ON k.id = i.karat_id
  LEFT JOIN v_current_gold_prices cp ON cp.karat_id = i.karat_id`;

// Adds today's final / min / max price and hides cost unless the user may see it.
export function presentItem(row, req) {
  const { billed_weight_g } = calcItemPrice(row, 0);
  const range = row.current_gram_price === null ? null : calcPriceRange(row, row.current_gram_price);
  const item = {
    ...row,
    billed_weight_g,
    price_now: range?.final ?? null, // final price = gold value + making
    price_min_now: range?.min ?? null,
    price_max_now: range?.max ?? null,
  };
  if (!hasPermission(req, 'items.view_cost')) delete item.cost_price;
  return item;
}

export async function findItem(db, id, req) {
  const [rows] = await db.query(`${ITEM_SELECT} WHERE i.id = ?`, [id]);
  if (!rows.length) throw new HttpError(404, 'Item not found');
  return presentItem(rows[0], req);
}
