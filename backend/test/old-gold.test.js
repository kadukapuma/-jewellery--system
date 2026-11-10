import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcOldGoldValue } from '../src/services/pricing.js';

test('old gold value is net weight × gram price', () => {
  assert.deepEqual(calcOldGoldValue({ gross_weight_g: 10 }, 12500), { net_weight_g: 10, value: 125000 });
});

test('stones are taken off the weight', () => {
  assert.deepEqual(calcOldGoldValue({ gross_weight_g: 8.25, stone_weight_g: 0.35 }, 12500), { net_weight_g: 7.9, value: 98750 });
});

test('deduction % is taken off the value', () => {
  assert.equal(calcOldGoldValue({ gross_weight_g: 10 }, 12500, 5).value, 118750);
  assert.equal(calcOldGoldValue({ gross_weight_g: 3.333 }, 11450.5, 2.5).value, 37210.4);
});
