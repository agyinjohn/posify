import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildDemoData } from '../src/lib/demoSeed.js';
import { r2, r3 } from '../src/lib/money.js';

const now = new Date('2026-11-18T16:30:00Z');
const ownerId = new mongoose.Types.ObjectId();
const data = buildDemoData({ now, ownerId, cashierIds: [new mongoose.Types.ObjectId()] });

test('demo: plenty of sales over six weeks, none in the future, unique receipts', () => {
  assert.ok(data.sales.length > 400, `${data.sales.length} sales`);
  assert.ok(data.sales.every((s) => s.createdAt <= now && s.total > 0));
  assert.equal(new Set(data.sales.map((s) => s.receiptNo)).size, data.sales.length);
  assert.equal(data.receipts, data.sales.length);
  assert.ok(data.sales.some((s) => s.createdAt.toISOString().slice(0, 10) === '2026-11-18'), 'sales today');
  assert.ok(data.sales.some((s) => s.items.some((i) => i.packQty)), 'some pack sales');
  assert.ok(data.sales.some((s) => s.status === 'voided') && data.sales.some((s) => s.status === 'partial-return'));
});

test('demo: stock history adds up to the stock on each product, never below zero', () => {
  for (const p of data.products) {
    const moves = data.moves.filter((m) => String(m.product) === String(p._id)).sort((a, b) => a.createdAt - b.createdAt);
    assert.equal(r3(moves.reduce((t, m) => t + m.qty, 0)), p.stock, p.name);
    assert.ok(p.stock >= 0);
  }
  assert.ok(data.products.some((p) => p.stock === 0) && data.products.some((p) => p.stock > 0 && p.stock <= p.reorderLevel), 'some out and some low');
});

test('demo: each customer owes exactly their credit sales less what they paid', () => {
  for (const c of data.customers) {
    const credit = data.sales.filter((s) => String(s.customer) === String(c._id)).reduce((t, s) => t + (s.balance - s.creditReturned), 0);
    const paid = data.payments.filter((p) => String(p.customer) === String(c._id)).reduce((t, p) => t + p.amount, 0);
    assert.equal(r2(credit - paid), c.balance, c.name);
    assert.ok(c.balance >= 0);
  }
  assert.ok(data.customers.some((c) => c.balance > 0));
});

test('demo: refunds match what the returned sales gave back; the same seed gives the same shop', () => {
  for (const s of data.sales.filter((x) => x.refundedTotal > 0)) {
    assert.equal(r2(data.refunds.filter((r) => String(r.sale) === String(s._id)).reduce((t, r) => t + r.amount, 0)), s.refundedTotal);
  }
  const again = buildDemoData({ now, ownerId, cashierIds: [] });
  assert.equal(again.sales.length > 0, true);
  assert.equal(again.products.map((p) => p.sku).join(), data.products.map((p) => p.sku).join());
});
