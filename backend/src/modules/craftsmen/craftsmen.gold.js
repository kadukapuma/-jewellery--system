const round3 = (n) => Math.round(n * 1000) / 1000;

// Gold each craftsman holds, split by karat: opening gold (in its karat) + every ledger entry.
// Returns Map(craftsman_id -> [{ karat_id, karat_name, gold_g }]) with zero rows left out.
export async function goldByKarat(db, craftsmanIds = null) {
  if (Array.isArray(craftsmanIds) && !craftsmanIds.length) return new Map();
  const filter = craftsmanIds ? 'WHERE t.craftsman_id IN (?)' : '';
  const [rows] = await db.query(
    `SELECT t.craftsman_id, t.karat_id, k.name AS karat_name, k.sort_order, SUM(t.g) AS gold_g
     FROM (
       SELECT id AS craftsman_id, opening_gold_karat_id AS karat_id, opening_gold_g AS g FROM craftsmen WHERE opening_gold_g <> 0
       UNION ALL
       SELECT craftsman_id, karat_id, weight_g FROM craftsman_gold_ledger
     ) t
     LEFT JOIN karats k ON k.id = t.karat_id
     ${filter}
     GROUP BY t.craftsman_id, t.karat_id, k.name, k.sort_order
     ORDER BY k.sort_order, t.karat_id`,
    craftsmanIds ? [craftsmanIds] : [],
  );
  const map = new Map();
  for (const r of rows) {
    const gold = round3(Number(r.gold_g));
    if (Math.abs(gold) < 0.0005) continue;
    if (!map.has(r.craftsman_id)) map.set(r.craftsman_id, []);
    map.get(r.craftsman_id).push({ karat_id: r.karat_id, karat_name: r.karat_name || 'No karat', gold_g: gold });
  }
  return map;
}

// Gold of one karat a craftsman holds.
export async function goldHeldOfKarat(db, craftsmanId, karatId) {
  const rows = (await goldByKarat(db, [craftsmanId])).get(craftsmanId) || [];
  return rows.find((r) => r.karat_id === karatId)?.gold_g ?? 0;
}
