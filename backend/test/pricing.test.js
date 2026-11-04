import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcItemPrice, calcPriceRange, gramFromPound, percentChange, poundByPurity } from '../src/services/pricing.js';

test('pound price is divided by 8 for the gram price', () => {
  assert.equal(gramFromPound(100000), 12500);
  assert.equal(gramFromPound(92000), 11500);
});

test('gram price is rounded to cents', () => {
  assert.equal(gramFromPound(100001), 12500.13); // 12500.125
  assert.equal(gramFromPound(99999.99), 12500);
});

test('grams per pound comes from the setting', () => {
  assert.equal(gramFromPound(100000, 10), 10000);
  assert.throws(() => gramFromPound(100000, 0));
});

test('percent change', () => {
  assert.equal(percentChange(103000, 100000), 3);
  assert.equal(percentChange(97000, 100000), -3);
  assert.equal(percentChange(100000, null), null);
  assert.equal(percentChange(100000, 0), null);
});

test('22K pound price from 24K by purity', () => {
  assert.equal(poundByPurity(100000, 0.999, 0.916), 91692);
});

test('craft ring: 7 g net + 1 g wastage at 12,500/g + 5,000 making = 105,000', () => {
  assert.deepEqual(calcItemPrice({ net_weight_g: 7, wastage_g: 1, making_charge: 5000 }, 12500), {
    billed_weight_g: 8,
    gold_value: 100000,
    making_charge: 5000,
    line_total: 105000,
  });
});

test('supplier item has no wastage', () => {
  assert.equal(calcItemPrice({ net_weight_g: 4.25 }, 11461.5).line_total, 48711.38); // 48711.375
});

test('weights add without floating point drift', () => {
  assert.equal(calcItemPrice({ net_weight_g: 7.1, wastage_g: 0.2 }, 1).billed_weight_g, 7.3);
});

test('instalment schedule splits evenly, last takes the rounding', async () => {
  const { buildSchedule } = await import('../src/modules/customer-payments/customer-payments.service.js');
  const rows = buildSchedule(100000, 3, 'monthly', '2026-01-31');
  assert.deepEqual(rows.map((r) => r.amount_due), [33333.33, 33333.33, 33333.34]);
  assert.equal(rows[0].due_date, '2026-01-31');
  assert.equal(rows[1].due_date, '2026-02-28');
  assert.equal(rows[2].due_date, '2026-03-31');
  assert.equal(buildSchedule(1000, 2, 'weekly', '2026-11-04')[1].due_date, '2026-11-11');
});

test('price range is a percentage of the final price and follows the gold price', () => {
  const ring = { net_weight_g: 7, wastage_g: 1, making_charge: 5000, price_min_percent: 5, price_max_percent: 20 };
  assert.deepEqual(calcPriceRange(ring, 12500), { final: 105000, min: 110250, max: 126000 });
  assert.deepEqual(calcPriceRange(ring, 13000), { final: 109000, min: 114450, max: 130800 });
  assert.deepEqual(calcPriceRange({ net_weight_g: 7 }, 10000), { final: 70000, min: 70000, max: 70000 });
  assert.equal(calcPriceRange({ net_weight_g: 1, price_max_percent: 12.5 }, 3333).max, 3749.63); // 3749.625
});
