import test from 'node:test';
import assert from 'node:assert/strict';
import { planVariants, comboKey } from '../src/lib/variants.js';
import { productLabel } from '../src/lib/productLabel.js';

const base = { name: 'Kente Dress', category: 'Dresses', costPrice: 80, retailPrice: 150 };

test('labels show size and colour', () => {
  assert.equal(productLabel({ name: 'Kente Dress', size: 'M', color: 'Red' }), 'Kente Dress (M, Red)');
  assert.equal(productLabel({ name: 'Kente Dress', color: 'Red' }), 'Kente Dress (Red)');
  assert.equal(productLabel({ name: 'Rice', size: '5kg' }), 'Rice (5kg)');
  assert.equal(productLabel({ name: 'Rice' }), 'Rice');
});

test('one product per combination, with SKUs made from the name, size and colour', () => {
  const out = planVariants({ base, combos: [{ size: 'M', color: 'Red', stock: 3 }, { size: 'L', color: 'Red' }, { size: 'M', color: 'Navy blue', barcode: '123' }] });
  assert.deepEqual(out.map((p) => [p.sku, p.size, p.color, p.stock]), [
    ['KENTE-DRESS-M-RED', 'M', 'Red', 3], ['KENTE-DRESS-L-RED', 'L', 'Red', 0], ['KENTE-DRESS-M-NAVY-BLUE', 'M', 'Navy blue', 0],
  ]);
  assert.match(out[0].barcode, /^2\d{12}$/); // made by the shop
  assert.match(out[1].barcode, /^2\d{12}$/);
  assert.notEqual(out[0].barcode, out[1].barcode);
  assert.equal(out[2].barcode, '123'); // the maker's barcode is kept
  assert.equal(out[0].retailPrice, 150);
  assert.equal(out[0].category, 'Dresses');
});

test('SKU prefix, clashes with the shop, duplicates and missing labels', () => {
  const out = planVariants({ base: { ...base, sku: 'KD1' }, combos: [{ size: 'S' }], takenSkus: new Set(['KD1-S']) });
  assert.equal(out[0].sku, 'KD1-S-2');
  assert.throws(() => planVariants({ base, combos: [{ size: 'M' }, { size: 'm ' }] }), /listed twice/);
  assert.throws(() => planVariants({ base, combos: [{ size: 'M' }], existing: new Set([comboKey('kente dress', 'M', '')]) }), /already exists/);
  assert.throws(() => planVariants({ base, combos: [{ size: '', color: '' }] }), /size or a colour/);
  assert.throws(() => planVariants({ base, combos: [{ size: 'M', sku: 'X' }], takenSkus: new Set(['X']) }), /SKU X/);
  assert.throws(() => planVariants({ base, combos: [{ size: 'M', barcode: '1' }, { size: 'L', barcode: '1' }] }), /Barcode 1/);
  assert.throws(() => planVariants({ base, combos: [{ size: 'M', stock: -1 }] }), /opening stock/);
  assert.throws(() => planVariants({ base, combos: [] }), /at least one/);
});
