import test from 'node:test';
import assert from 'node:assert/strict';
import { priceSale, settlePayments, SaleError } from '../src/lib/pricing.js';

const mk = (over = {}) => ({ _id: 'p1', name: 'Rice 5kg', sku: 'R5', costPrice: 40, retailPrice: 60, wholesalePrice: 50, active: true, ...over });
const map = (...ps) => new Map(ps.map((p) => [p._id, p]));

test('pieces always sell at the piece price, whatever sale type an older till sends', () => {
  const m = map(mk());
  assert.equal(priceSale({ lines: [{ productId: 'p1', qty: 2 }], productsById: m, mode: 'retail' }).total, 120);
  assert.equal(priceSale({ lines: [{ productId: 'p1', qty: 2 }], productsById: m, mode: 'wholesale' }).total, 120);
  assert.equal(priceSale({ lines: [{ productId: 'p1', qty: 2 }], productsById: m }).total, 120); // new tills send no mode
  assert.throws(() => priceSale({ lines: [{ productId: 'p1', qty: 2 }], productsById: m, mode: 'cheap' }), SaleError);
});

test('wholesale falls back to retail when no wholesale price is set', () => {
  const m = map(mk({ wholesalePrice: 0 }));
  assert.equal(priceSale({ lines: [{ productId: 'p1', qty: 1 }], productsById: m, mode: 'wholesale' }).total, 60);
});

test('duplicate lines for the same product are merged', () => {
  const r = priceSale({ lines: [{ productId: 'p1', qty: 1 }, { productId: 'p1', qty: 2 }], productsById: map(mk()), mode: 'retail' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].qty, 3);
});

test('a fully discounted sale is rejected', () => {
  assert.throws(() => priceSale({ lines: [{ productId: 'p1', qty: 1, discount: 500 }], productsById: map(mk()), mode: 'retail' }), SaleError);
});

test('rejects zero, negative and non-numeric quantities', () => {
  for (const qty of [0, -1, 'abc', NaN, Infinity]) {
    assert.throws(() => priceSale({ lines: [{ productId: 'p1', qty }], productsById: map(mk()), mode: 'retail' }), SaleError);
  }
});

test('rejects unknown or inactive products and bad modes', () => {
  assert.throws(() => priceSale({ lines: [{ productId: 'zzz', qty: 1 }], productsById: map(mk()), mode: 'retail' }), SaleError);
  assert.throws(() => priceSale({ lines: [{ productId: 'p1', qty: 1 }], productsById: map(mk({ active: false })), mode: 'retail' }), SaleError);
  assert.throws(() => priceSale({ lines: [{ productId: 'p1', qty: 1 }], productsById: map(mk()), mode: 'hacker' }), SaleError);
});

test('avoids floating point drift on money', () => {
  const r = priceSale({ lines: [{ productId: 'p1', qty: 3 }], productsById: map(mk({ retailPrice: 0.1 })), mode: 'retail' });
  assert.equal(r.total, 0.3);
});

test('exact payment leaves no balance', () => {
  const s = settlePayments([{ method: 'MoMo', amount: 100 }], 100);
  assert.deepEqual([s.amountPaid, s.change, s.balance], [100, 0, 0]);
});

test('split payment across methods', () => {
  const s = settlePayments([{ method: 'Cash', amount: 40 }, { method: 'MoMo', amount: 60 }], 100);
  assert.equal(s.balance, 0);
  assert.equal(s.payments.length, 2);
});

test('cash overpayment becomes change and is removed from the cash line', () => {
  const s = settlePayments([{ method: 'Cash', amount: 120 }], 100);
  assert.equal(s.change, 20);
  assert.equal(s.payments[0].amount, 100);
});

test('overpaying by MoMo or card is rejected', () => {
  assert.throws(() => settlePayments([{ method: 'MoMo', amount: 150 }], 100), SaleError);
});

test('underpayment is recorded as a balance owed', () => {
  const s = settlePayments([{ method: 'Cash', amount: 30 }], 100);
  assert.equal(s.balance, 70);
});

test('no payment at all means the whole total is on credit', () => {
  assert.equal(settlePayments([], 100).balance, 100);
});

test('rejects unknown payment methods and bad amounts', () => {
  assert.throws(() => settlePayments([{ method: 'Bitcoin', amount: 10 }], 100), SaleError);
  assert.throws(() => settlePayments([{ method: 'Cash', amount: -5 }], 100), SaleError);
});

// ── Unit conversion (carton ↔ piece) ─────────────────────────────────────────

const mkPack = (over = {}) => ({
  _id: 'p2', name: 'Milo 400g', sku: 'M4', costPrice: 10, retailPrice: 15,
  wholesalePrice: 0, active: true, unitsPerPack: 12, packLabel: 'ctn', ...over,
});

test('selling 2 cartons of 12 charges for 24 pieces', () => {
  const m = map(mkPack());
  const r = priceSale({ lines: [{ productId: 'p2', qty: 2, unit: 'pack' }], productsById: m, mode: 'retail' });
  assert.equal(r.items[0].qty, 24);
  assert.equal(r.total, 24 * 15);
});

test('pack qty and label are preserved on the item', () => {
  const m = map(mkPack());
  const r = priceSale({ lines: [{ productId: 'p2', qty: 3, unit: 'pack' }], productsById: m, mode: 'retail' });
  assert.equal(r.items[0].packQty, 3);
  assert.equal(r.items[0].packLabel, 'ctn');
  assert.equal(r.items[0].unitsPerPack, 12);
});

test('unit:piece on a pack product sells individual pieces', () => {
  const m = map(mkPack());
  const r = priceSale({ lines: [{ productId: 'p2', qty: 5, unit: 'piece' }], productsById: m, mode: 'retail' });
  assert.equal(r.items[0].qty, 5);
  assert.equal(r.items[0].packQty, null);
});

test('product with unitsPerPack=1 ignores unit:pack', () => {
  const m = map(mk()); // unitsPerPack defaults to 1
  const r = priceSale({ lines: [{ productId: 'p1', qty: 4, unit: 'pack' }], productsById: m, mode: 'retail' });
  assert.equal(r.items[0].qty, 4); // no expansion
  assert.equal(r.items[0].packQty, null);
});

test('packs and loose pieces of one product are kept apart for the receipt', () => {
  const p = mk({ unitsPerPack: 12, packLabel: 'ctn', retailPrice: 5, wholesalePrice: 0 });
  const r = priceSale({
    lines: [{ productId: 'p1', qty: 2, unit: 'pack' }, { productId: 'p1', qty: 3 }],
    productsById: map(p), mode: 'retail',
  });
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.qty, 27);       // 2*12 + 3 pieces: stock and returns still work in pieces
  assert.equal(it.packQty, 2);
  assert.equal(it.loosePcs, 3);
  assert.equal(r.total, 135);
});

test('pack-only and piece-only lines have no spurious loose pieces', () => {
  const p = mk({ unitsPerPack: 12, packLabel: 'ctn' });
  const packOnly = priceSale({ lines: [{ productId: 'p1', qty: 1, unit: 'pack' }], productsById: map(p), mode: 'retail' }).items[0];
  assert.equal(packOnly.loosePcs, null);
  const pcsOnly = priceSale({ lines: [{ productId: 'p1', qty: 4 }], productsById: map(p), mode: 'retail' }).items[0];
  assert.equal(pcsOnly.packQty, null);
  assert.equal(pcsOnly.loosePcs, null);
});

// ── pack (carton/box) prices ────────────────────────────────────────────────
import { packSpecificPrice, packPriceFor, pieceUnitPrice } from '../src/lib/unitPrices.js';
const carton = (over = {}) => mk({ unitsPerPack: 12, packLabel: 'ctn', retailPrice: 12, wholesalePrice: 0, ...over });

test('a pack can have its own price, cheaper than the pieces added up', () => {
  const p = carton({ packRetailPrice: 120 });
  const one = priceSale({ lines: [{ productId: 'p1', qty: 1, unit: 'pack' }], productsById: map(p), mode: 'retail' });
  assert.equal(one.total, 120);                       // not 12 x 12 = 144
  assert.equal(one.items[0].packPrice, 120);
  assert.equal(one.items[0].qty, 12);                 // stock still moves in pieces
  const loose = priceSale({ lines: [{ productId: 'p1', qty: 12 }], productsById: map(p), mode: 'retail' });
  assert.equal(loose.total, 144);                     // 12 single pieces at the piece price
});

test('packs and loose pieces of one product are each charged their own price', () => {
  const p = carton({ packRetailPrice: 120 });
  const r = priceSale({ lines: [{ productId: 'p1', qty: 2, unit: 'pack' }, { productId: 'p1', qty: 3 }], productsById: map(p), mode: 'retail' });
  assert.equal(r.total, 276);                         // 2 x 120 + 3 x 12
  const it = r.items[0];
  assert.deepEqual([it.qty, it.packQty, it.loosePcs, it.unitPrice, it.packPrice], [27, 2, 3, 12, 120]);
});

test('without a pack price a pack is just pieces x the piece price', () => {
  const p = carton();
  const r = priceSale({ lines: [{ productId: 'p1', qty: 1, unit: 'pack' }], productsById: map(p), mode: 'retail' });
  assert.equal(r.total, 144);
  assert.equal(r.items[0].packPrice, 144);
  assert.equal(packSpecificPrice(p, 'retail'), null);
});

test('the carton price is the pack price; products saved before keep their old wholesale carton pricing', () => {
  const sale = (p, mode) => priceSale({ lines: [{ productId: 'p1', qty: 1, unit: 'pack' }], productsById: map(p), mode }).total;
  assert.equal(sale(carton({ packRetailPrice: 100 })), 100);
  assert.equal(sale(carton({ packRetailPrice: 100 }), 'wholesale'), 100);      // the sale type changes nothing
  assert.equal(sale(carton()), 144);                                            // no pack price: 12 x 12
  // older records
  assert.equal(sale(carton({ packRetailPrice: 120, packWholesalePrice: 100 })), 100); // the wholesale carton price wins
  assert.equal(sale(carton({ wholesalePrice: 9 })), 108);                             // wholesale per piece, by the carton
  // and single pieces are always the piece price
  assert.equal(pieceUnitPrice(carton({ wholesalePrice: 9 })), 12);
});

test('a product with no pack size ignores any pack price', () => {
  const p = mk({ unitsPerPack: 1, packRetailPrice: 5 });
  assert.equal(packSpecificPrice(p, 'retail'), null);
  assert.equal(priceSale({ lines: [{ productId: 'p1', qty: 2 }], productsById: map(p), mode: 'retail' }).total, 120);
  assert.equal(packPriceFor(carton({ packRetailPrice: 120 }), 'retail'), 120);
  assert.equal(packPriceFor(carton(), 'retail'), 144);
});

test('discounts apply to the combined line', () => {
  const p = carton({ packRetailPrice: 120 });
  const r = priceSale({ lines: [{ productId: 'p1', qty: 1, unit: 'pack', discount: 20 }], productsById: map(p), mode: 'retail' });
  assert.equal(r.total, 100);
  assert.equal(r.discountTotal, 20);
});

test('a product size is part of the name on the sale (receipt, reports, returns)', () => {
  const r = priceSale({ lines: [{ productId: 'p1', qty: 1 }], productsById: map(mk({ name: 'Super Star', size: 'Small', wholesalePrice: 0 })), mode: 'retail' });
  assert.equal(r.items[0].name, 'Super Star (Small)');
  const plain = priceSale({ lines: [{ productId: 'p1', qty: 1 }], productsById: map(mk({ size: '  ' })), mode: 'retail' });
  assert.equal(plain.items[0].name, 'Rice 5kg');
});
