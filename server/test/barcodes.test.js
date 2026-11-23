import test from 'node:test';
import assert from 'node:assert/strict';
import { ean13, ean13CheckDigit, fillBarcodes, isEan13, newBarcode } from '../src/lib/barcodes.js';
import { planVariants } from '../src/lib/variants.js';
import { planImport } from '../src/lib/productImport.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('EAN-13 check digit matches known codes', () => {
  assert.equal(ean13CheckDigit('400638133393'), '1'); // 4006381333931
  assert.equal(ean13CheckDigit('590123412345'), '7'); // 5901234123457
  assert.ok(isEan13('4006381333931'));
  assert.ok(!isEan13('4006381333932'));
});

test('shop barcodes are 13 digits, start with 2 and are valid', () => {
  for (let i = 0; i < 200; i += 1) {
    const c = newBarcode();
    assert.match(c, /^2\d{12}$/);
    assert.ok(isEan13(c));
  }
});

test('a taken barcode is never handed out again', () => {
  const zeros = ean13('200000000000');
  const taken = new Set([zeros]);
  const rand = seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const c = newBarcode(taken, rand);
  assert.notEqual(c, zeros);
  assert.ok(taken.has(c));
});

test('fillBarcodes keeps existing ones and fills the rest uniquely', () => {
  const rows = [{ barcode: '5901234123457' }, {}, {}, { barcode: '' }];
  assert.equal(fillBarcodes(rows), 3);
  assert.equal(rows[0].barcode, '5901234123457');
  assert.equal(new Set(rows.map((r) => r.barcode)).size, 4);
});

test('sizes/colours without a barcode get one; given ones are kept', () => {
  const docs = planVariants({ base: { name: 'Dress', retailPrice: 100 }, combos: [{ size: 'S' }, { size: 'M', barcode: '5901234123457' }] });
  assert.ok(isEan13(docs[0].barcode) && docs[0].barcode.startsWith('2'));
  assert.equal(docs[1].barcode, '5901234123457');
});

test('import gives new rows a barcode, but not skipped ones', () => {
  const row = (n, data) => ({ row: n, data: { name: `P${n}`, retailPrice: 10, stock: 0, ...data }, errors: [], warnings: [] });
  const plan = planImport({
    rows: [row(2, { sku: 'A' }), row(3, { sku: 'OLD' }), row(4, { sku: 'B', barcode: '5901234123457' })],
    existingBySku: new Map([['OLD', { _id: 'x', sku: 'OLD' }]]), existingByBarcode: new Map(), mode: 'skip',
  });
  assert.ok(isEan13(plan[0].data.barcode));
  assert.equal(plan[1].status, 'skip');
  assert.equal(plan[1].data.barcode, undefined);
  assert.equal(plan[2].data.barcode, '5901234123457');
});
