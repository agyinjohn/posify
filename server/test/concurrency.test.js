import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCount } from '../src/lib/stocktake.js';
import { balanceFilter } from '../src/lib/balance.js';

// Tiny in-memory "product" with compare-and-set, to mimic findOneAndUpdate({stock: expected}).
const makeStock = (initial, onRead) => {
  let stock = initial;
  return {
    get: () => stock,
    sell: (n) => { stock -= n; },
    read: async () => { const v = stock; if (onRead) onRead(); return v; },
    cas: async (expected, value) => { if (stock !== expected) return false; stock = value; return true; },
  };
};

test('stock take sets stock and reports the variance', async () => {
  const s = makeStock(10);
  const r = await applyCount({ read: s.read, cas: s.cas, counted: 8 });
  assert.deepEqual(r, { systemQty: 10, variance: -2 });
  assert.equal(s.get(), 8);
});

test('a matching count writes nothing', async () => {
  const s = makeStock(5);
  assert.deepEqual(await applyCount({ read: s.read, cas: s.cas, counted: 5 }), { systemQty: 5, variance: 0 });
});

test('a sale landing between read and write is not wiped: variance is recomputed', async () => {
  let once = true;
  const s = makeStock(10, () => { if (once) { once = false; s.sell(3); } }); // sale of 3 right after first read
  const r = await applyCount({ read: s.read, cas: s.cas, counted: 9 });
  assert.deepEqual(r, { systemQty: 7, variance: 2 }); // based on the real stock (7), not the stale 10
  assert.equal(s.get(), 9);
});

test('gives up (returns null) if stock keeps changing, and never overwrites', async () => {
  const s = makeStock(100, () => s.sell(1));
  assert.equal(await applyCount({ read: s.read, cas: s.cas, counted: 50, retries: 3 }), null);
  assert.ok(s.get() > 90);
});

test('a deleted product returns null', async () => {
  assert.equal(await applyCount({ read: async () => null, cas: async () => true, counted: 1 }), null);
});

test('credit limit is part of the atomic filter', () => {
  assert.deepEqual(balanceFilter('c', 40, { maxBalance: 100 }), { _id: 'c', balance: { $lte: 60.005 } });
  assert.deepEqual(balanceFilter('c', 40, { maxBalance: 0 }), { _id: 'c' }); // 0 = no limit
  assert.deepEqual(balanceFilter('c', -40, { maxBalance: 100 }), { _id: 'c' }); // reductions are never blocked
  assert.deepEqual(balanceFilter('c', -40, { requireCovered: true }), { _id: 'c', balance: { $gte: 39.995 } });
});
