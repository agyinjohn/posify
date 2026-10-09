import test from 'node:test';
import assert from 'node:assert/strict';
import { priceSale, settlePayments, SaleError } from '../src/lib/pricing.js';

const mk = (over = {}) => ({ _id: 'p1', name: 'Rice 5kg', sku: 'R5', costPrice: 40, retailPrice: 60, wholesalePrice: 50, active: true, ...over });
const map = (...ps) => new Map(ps.map((p) => [p._id, p]));

test('retail uses retail price, wholesale uses wholesale price', () => {
  const m = map(mk());
  assert.equal(priceSale({ lines: [{ productId: 'p1', qty: 2 }], productsById: m, mode: 'retail' }).total, 120);
  assert.equal(priceSale({ lines: [{ productId: 'p1', qty: 2 }], productsById: m, mode: 'wholesale' }).total, 100);
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
