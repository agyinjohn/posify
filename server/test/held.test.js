import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHeldItems } from '../src/lib/held.js';
import { SaleError } from '../src/lib/pricing.js';

const ok = () => true;

test('held items keep the pack unit and default to piece', () => {
  const out = cleanHeldItems([
    { productId: 'a', qty: 2, unit: 'pack', discount: 1.5 },
    { productId: 'b', qty: 3 },
    { productId: 'c', qty: 1, unit: 'weird' },
  ], ok);
  assert.deepEqual(out.map((i) => i.unit), ['pack', 'piece', 'piece']);
  assert.equal(out[0].qty, 2);
  assert.equal(out[0].discount, 1.5);
  assert.equal(out[1].discount, 0);
});

test('bad held items are rejected', () => {
  assert.throws(() => cleanHeldItems([], ok), SaleError);
  assert.throws(() => cleanHeldItems([{ productId: 'a', qty: 0 }], ok), SaleError);
  assert.throws(() => cleanHeldItems([{ productId: 'a', qty: 'x' }], ok), SaleError);
  assert.throws(() => cleanHeldItems([{ productId: 'bad', qty: 1 }], () => false), SaleError);
});

test('negative discounts are clamped to zero', () => {
  assert.equal(cleanHeldItems([{ productId: 'a', qty: 1, discount: -5 }], ok)[0].discount, 0);
});
