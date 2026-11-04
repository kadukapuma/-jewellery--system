// Pure price calculations (no database), shared by price setup and, later, sales.

export const DEFAULT_GRAMS_PER_POUND = 8;

// 1 pound (sovereign) price -> 1 gram price, rounded to cents.
export function gramFromPound(poundPrice, gramsPerPound = DEFAULT_GRAMS_PER_POUND) {
  if (!(gramsPerPound > 0)) throw new Error('grams per pound must be above 0');
  return Math.round((poundPrice * 100) / gramsPerPound) / 100;
}

// % change from previous to current, 2 decimals; null when there is no previous price.
export function percentChange(current, previous) {
  if (previous === null || previous === undefined || Number(previous) === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

const round2 = (n) => Math.round(n * 100) / 100;
// Weights are added in whole milligrams so 7.1 + 0.2 is exactly 7.3.
const addWeights = (a, b) => (Math.round(a * 1000) + Math.round(b * 1000)) / 1000;

// Customer price of one item at a given gram price:
//   billed weight = net weight + wastage (the full gold the craftsman used)
//   gold value    = billed weight × gram price
//   line total    = gold value + making charge
export function calcItemPrice({ net_weight_g, wastage_g = 0, making_charge = 0 }, gramPrice) {
  const billed_weight_g = addWeights(Number(net_weight_g), Number(wastage_g));
  const gold_value = round2(billed_weight_g * gramPrice);
  return { billed_weight_g, gold_value, making_charge: Number(making_charge), line_total: round2(gold_value + Number(making_charge)) };
}

// Pound price of another karat derived from a base karat by purity (e.g. 22K from 24K).
export function poundByPurity(basePoundPrice, basePurity, targetPurity) {
  return Math.round((basePoundPrice * targetPurity) / basePurity);
}
