// Same maths as backend/src/services/pricing.js - keep them in step.
const round2 = (n) => Math.round(n * 100) / 100;

export function gramFromPound(poundPrice, gramsPerPound) {
  return Math.round((poundPrice * 100) / gramsPerPound) / 100;
}

// billed weight = net + wastage; gold value = billed × gram price; total = gold value + making
export function calcItemPrice({ net_weight_g, wastage_g = 0, making_charge = 0 }, gramPrice) {
  const billed_weight_g = (Math.round(Number(net_weight_g || 0) * 1000) + Math.round(Number(wastage_g || 0) * 1000)) / 1000;
  const gold_value = round2(billed_weight_g * gramPrice);
  return { billed_weight_g, gold_value, making_charge: Number(making_charge || 0), line_total: round2(gold_value + Number(making_charge || 0)) };
}

// final = gold value + making; min / max = final + the item's % (so they follow the gold price).
export function priceAtPercent(final, percent) {
  return round2(final * (1 + Number(percent || 0) / 100));
}

export function calcPriceRange(item, gramPrice) {
  const final = calcItemPrice(item, gramPrice).line_total;
  return { final, min: priceAtPercent(final, item.price_min_percent), max: priceAtPercent(final, item.price_max_percent) };
}

export function formatWeight(g) {
  if (g === null || g === undefined || g === '') return '—';
  return `${Number(g).toFixed(3)} g`;
}
