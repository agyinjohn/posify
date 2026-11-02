import test from 'node:test';
import assert from 'node:assert/strict';
import { planReturn, returnedValueOf, netSale } from '../src/lib/returns.js';
import { SaleError } from '../src/lib/pricing.js';

// 2 x Rice @60 (120) + 1 x Oil @30 = 150 subtotal, 15 order discount => total 135 (factor 0.9)
const mk = (over = {}) => ({
  subtotal: 150, total: 135, orderDiscount: 15, balance: 0, amountPaid: 135, creditReturned: 0, customer: undefined,
  items: [
    { product: 'rice', name: 'Rice', qty: 2, lineTotal: 120, costPrice: 40, returnedQty: 0 },
    { product: 'oil', name: 'Oil', qty: 1, lineTotal: 30, costPrice: 20, returnedQty: 0 },
  ],
  ...over,
});

test('partial return refunds the discounted value in cash on a paid sale', () => {
  const plan = planReturn(mk(), { lines: [{ productId: 'rice', qty: 1 }] });
  assert.equal(plan.value, 54); // 60 * 0.9
  assert.equal(plan.creditReduction, 0);
  assert.equal(plan.cashRefund, 54);
  assert.equal(plan.fullyReturned, false);
});

test('returning everything refunds exactly the sale total (no rounding drift)', () => {
  const s = mk({ subtotal: 100, total: 99.99, orderDiscount: 0.01, items: [
    { product: 'a', name: 'A', qty: 3, lineTotal: 33.33, costPrice: 1, returnedQty: 0 },
    { product: 'b', name: 'B', qty: 3, lineTotal: 33.33, costPrice: 1, returnedQty: 0 },
    { product: 'c', name: 'C', qty: 3, lineTotal: 33.34, costPrice: 1, returnedQty: 0 },
  ] });
  const one = planReturn(s, { lines: [{ productId: 'a', qty: 1 }] });
  assert.ok(one.value > 0);
  const all = planReturn(s, { all: true });
  assert.equal(all.value, 99.99);
  assert.equal(all.fullyReturned, true);
});

test('credit owed is cancelled first, the rest is refunded', () => {
  const s = mk({ customer: 'c1', balance: 100, amountPaid: 35 });
  const plan = planReturn(s, { lines: [{ productId: 'rice', qty: 2 }] }); // value 108
  assert.equal(plan.value, 108);
  assert.equal(plan.creditReduction, 100);
  assert.equal(plan.cashRefund, 8);
});

test('repeat returns cannot cancel more credit than the sale ever owed', () => {
  const s = mk({ customer: 'c1', balance: 60, amountPaid: 75 });
  const p1 = planReturn(s, { lines: [{ productId: 'rice', qty: 1 }] }); // value 54
  assert.equal(p1.creditReduction, 54);
  const s2 = { ...s, creditReturned: 54, items: s.items.map((i) => (i.product === 'rice' ? { ...i, returnedQty: 1 } : i)) };
  const p2 = planReturn(s2, { lines: [{ productId: 'rice', qty: 1 }] }); // value 54, only 6 still owed
  assert.equal(p2.creditReduction, 6);
  assert.equal(p2.cashRefund, 48);
  // a void afterwards only has the oil left (27) and no credit outstanding
  const s3 = { ...s2, creditReturned: 60, items: s2.items.map((i) => (i.product === 'rice' ? { ...i, returnedQty: 2 } : i)) };
  const v = planReturn(s3, { all: true });
  assert.equal(v.value, 27);
  assert.equal(v.creditReduction, 0);
  assert.equal(v.cashRefund, 27);
  assert.equal(v.fullyReturned, true);
});

test('credit reduction never exceeds what the customer currently owes', () => {
  const s = mk({ customer: 'c1', balance: 100, amountPaid: 35 });
  const plan = planReturn(s, { lines: [{ productId: 'rice', qty: 2 }], customerBalance: 40 });
  assert.equal(plan.creditReduction, 40);
  assert.equal(plan.cashRefund, 68);
});

test('fractional quantities use 3 decimals (not 2)', () => {
  const s = mk({ subtotal: 125, total: 125, orderDiscount: 0, items: [{ product: 'k', name: 'Kg', qty: 1, lineTotal: 125, costPrice: 50, returnedQty: 0 }] });
  const plan = planReturn(s, { lines: [{ productId: 'k', qty: 0.125 }] });
  assert.equal(plan.updates[0].qty, 0.125);
  assert.equal(plan.value, 15.63);
  const s2 = { ...s, items: [{ ...s.items[0], qty: 0.375, returnedQty: 0.125 }] };
  assert.doesNotThrow(() => planReturn(s2, { lines: [{ productId: 'k', qty: 0.25 }] }));
});

test('rejects over-returns, unknown products, and fully returned sales', () => {
  assert.throws(() => planReturn(mk(), { lines: [{ productId: 'rice', qty: 3 }] }), SaleError);
  assert.throws(() => planReturn(mk(), { lines: [{ productId: 'nope', qty: 1 }] }), SaleError);
  const done = mk({ items: mk().items.map((i) => ({ ...i, returnedQty: i.qty })) });
  assert.throws(() => planReturn(done, { all: true }), SaleError);
});

test('netSale reflects returns for reports and cash-up', () => {
  const s = mk({ items: mk().items.map((i) => (i.product === 'rice' ? { ...i, returnedQty: 1 } : i)) });
  assert.equal(returnedValueOf(s), 54);
  const n = netSale(s);
  assert.equal(n.net, 81);
  // remaining: rice 60-40=20, oil 30-20=10, minus order discount share 15*0.6=9 => 21
  assert.equal(n.profit, 21);
});
