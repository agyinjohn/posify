import test from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_SIZES, sizeById, layoutLabels, labelCode, barcodeFits, labelsDocument } from '../src/labels.js';

const rice = { _id: 'r', name: 'Rice', sku: 'DEMO-001', barcode: '6034000123456', retailPrice: 125 };
const soap = { _id: 's', name: 'Key Soap', sku: 'DEMO-014', retailPrice: 6 };

test('the label scans as the barcode, or the SKU when there is none', () => {
  assert.equal(labelCode(rice), '6034000123456');
  assert.equal(labelCode(soap), 'DEMO-014');
  assert.equal(labelCode({ ...soap, barcode: '  ' }), 'DEMO-014');
});

test('sheets: copies fill cells in order, a part-used sheet skips cells, pages split when full', () => {
  const size = sizeById('a4-3x8'); // 24 per page
  const pages = layoutLabels([{ product: rice, copies: 20 }, { product: soap, copies: 10 }], size, { skip: 5 });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 24);
  assert.deepEqual(pages[0].slice(0, 6).map((c) => c?.sku ?? null), [null, null, null, null, null, 'DEMO-001']);
  assert.equal(pages[1].length, 35 - 24);
  assert.equal(pages.flat().filter(Boolean).length, 30);
  assert.deepEqual(layoutLabels([{ product: rice, copies: 0 }], size), []);
});

test('rolls: one label per page; every size fits on its paper', () => {
  assert.equal(layoutLabels([{ product: rice, copies: 3 }], sizeById('roll-50x25')).length, 3);
  for (const s of LABEL_SIZES.filter((x) => x.cols)) {
    assert.ok(s.cols * s.w <= 210 && s.rows * s.h <= 297, s.id);
  }
});

test('long codes on small labels are flagged; the document has one label block per copy', () => {
  assert.equal(barcodeFits('DEMO-014', sizeById('roll-38x25')), true);
  assert.equal(barcodeFits('KENTE-PRINT-SHIRT-XL-BLUE-2026', sizeById('roll-38x25')), false);
  const size = sizeById('a4-4x10');
  const html = labelsDocument(layoutLabels([{ product: soap, copies: 3 }], size), size,
    { shopName: 'My <Shop>', showPrice: true, showShop: true, priceOf: (p) => `GH₵${p.retailPrice}`, nameOf: (p) => p.name });
  assert.equal((html.match(/class="lb"/g) || []).length, 3);
  assert.match(html, /@page \{ size: A4/);
  assert.doesNotMatch(html, /lb-shop">/, 'no room for the shop name on a 25 mm label');
  const big = sizeById('a4-3x8');
  assert.match(labelsDocument([[soap]], big, { shopName: 'My <Shop>', showShop: true, priceOf: () => '', nameOf: (p) => p.name }), /My &lt;Shop&gt;/);
  assert.match(html, /DEMO-014/);
  assert.match(labelsDocument([[soap]], sizeById('roll-40x30'), { priceOf: () => '', nameOf: (p) => p.name, showPrice: false }), /size: 40mm 30mm/);
});

test('the price can be left off for some products and kept for others', () => {
  const size = sizeById('a4-3x8');
  const html = labelsDocument(layoutLabels([{ product: rice, copies: 1 }, { product: soap, copies: 1 }], size), size,
    { showPrice: (p) => p._id === 'r', priceOf: (p) => `GH₵${p.retailPrice}`, nameOf: (p) => p.name });
  assert.match(html, /GH₵125/);
  assert.doesNotMatch(html, /GH₵6</);
  assert.equal((html.match(/class="lb-price"/g) || []).length, 1);
});
