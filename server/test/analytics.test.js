import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, summarize, previousRange, daysBetween, topWithOther } from '../src/lib/analytics.js';

const sale = (o = {}) => ({
  createdAt: '2026-11-02T09:30:00Z', status: 'completed', mode: 'retail', total: 100, subtotal: 100, orderDiscount: 0, discountTotal: 0,
  balance: 0, creditReturned: 0, refundedTotal: 0, cashier: 'u1', payments: [{ method: 'Cash', amount: 100 }],
  items: [{ product: 'p1', name: 'Rice', sku: 'R', qty: 2, returnedQty: 0, lineTotal: 100, costPrice: 30 }],
  ...o,
});
const products = [
  { _id: 'p1', name: 'Rice', sku: 'R', category: 'Grains', stock: 10, costPrice: 30, active: true },
  { _id: 'p2', name: 'Oil', sku: 'O', category: 'Oils', stock: 4, costPrice: 50, active: true },
  { _id: 'p3', name: 'Salt', sku: 'S', category: 'Grains', stock: 0, costPrice: 1, active: true },
];
const users = [{ _id: 'u1', name: 'Ama' }, { _id: 'u2', name: 'Kofi' }];

test('ranges: days listed inclusive, previous period of the same length', () => {
  assert.deepEqual(daysBetween('2026-11-01', '2026-11-03'), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepEqual(previousRange('2026-11-01', '2026-11-07'), { from: '2026-10-25', to: '2026-10-31' });
  assert.deepEqual(previousRange('2026-11-04', '2026-11-04'), { from: '2026-11-03', to: '2026-11-03' });
});

test('totals are net of returns, voids count nothing, legacy voids are ignored', () => {
  const t = summarize([
    sale(),
    sale({ status: 'partial-return', items: [{ product: 'p1', qty: 2, returnedQty: 1, lineTotal: 100, costPrice: 30 }] }),
    sale({ status: 'voided', items: [{ product: 'p1', qty: 2, returnedQty: 2, lineTotal: 100, costPrice: 30 }] }),
    { ...sale({ status: 'voided' }), refundedTotal: undefined },
  ]);
  assert.equal(t.revenue, 150);         // 100 + 50 (half returned) + 0
  assert.equal(t.profit, 60);           // (100-60) + (50-30)
  assert.equal(t.salesCount, 2);
  assert.equal(t.itemsSold, 3);
  assert.equal(t.avgSale, 75);
  assert.equal(t.margin, 40);
});

test('overview: trend by day/hour/weekday, change vs previous, payments net of refunds', () => {
  const o = buildOverview({
    from: '2026-11-01', to: '2026-11-03', products, users,
    sales: [sale(), sale({ createdAt: '2026-11-03T14:05:00Z', cashier: 'u2', mode: 'wholesale', payments: [{ method: 'MoMo', amount: 100 }] })],
    prevSales: [sale({ createdAt: '2026-10-30T10:00:00Z' })],
    refunds: [{ method: 'Cash', amount: 10 }],
    custPayments: [{ method: 'Cash', amount: 25 }],
  });
  assert.deepEqual(o.daily.map((d) => d.revenue), [0, 100, 100]); // every day present, even with no sales
  assert.equal(o.byHour[9].sales, 1);
  assert.equal(o.byHour[14].revenue, 100);
  assert.equal(o.byWeekday[1].sales, 1); // 2 Nov 2026 is a Monday
  assert.equal(o.change.revenue, 100);   // 200 vs 100
  assert.deepEqual(o.byMethod.find((m) => m.method === 'Cash').amount, 115); // 100 + 25 debt - 10 refund
  assert.equal(o.totals.debtCollected, 25);
  assert.equal(o.totals.refunded, 10);
  assert.deepEqual(o.cashiers.map((c) => c.name), ['Ama', 'Kofi']);
  assert.deepEqual(o.byUnit.map((u) => [u.unit, u.revenue]), [['pieces', 200], ['packs', 0]]);
});

test('overview: best products, categories and stock that did not sell', () => {
  const o = buildOverview({
    from: '2026-11-01', to: '2026-11-03', products, users,
    sales: [sale(), sale({ items: [{ product: 'p1', name: 'Rice', qty: 1, lineTotal: 50, costPrice: 30 }] })],
  });
  assert.deepEqual(o.topProducts.map((p) => [p.name, p.qty, p.revenue, p.profit]), [['Rice', 3, 150, 60]]);
  assert.equal(o.topProducts[0].margin, 40);
  assert.deepEqual(o.categories.map((c) => [c.name, c.revenue]), [['Grains', 150]]);
  assert.deepEqual(o.idleStock, { count: 1, value: 200, top: [{ id: 'p2', name: 'Oil', sku: 'O', stock: 4, value: 200 }] }); // Salt has no stock
  assert.equal(o.change.revenue, null); // nothing in the previous period: no percentage
});

test('long lists fold the tail into one "Other" row', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, revenue: 100 - i }));
  const out = topWithOther(rows, 6);
  assert.equal(out.length, 7);
  assert.equal(out[6].name, 'Other (3)');
  assert.equal(out[6].revenue, 92 + 93 + 94 - 0); // 94 + 93 + 92
  assert.equal(topWithOther(rows.slice(0, 7), 6).length, 7); // 7 rows: no point folding one
});

test('money is split between single pieces and full packs', () => {
  const o = buildOverview({
    from: '2026-11-01', to: '2026-11-03', products, users,
    sales: [sale({ total: 156, subtotal: 156, items: [{ product: 'p2', name: 'Oil', qty: 27, returnedQty: 0, lineTotal: 156, costPrice: 4, packQty: 2, loosePcs: 3, packPrice: 60, unitPrice: 12, unitsPerPack: 12 }] })],
  });
  // 2 cartons x 60 = 120 and 3 pieces x 12 = 36
  assert.deepEqual(o.byUnit.map((u) => [u.unit, u.revenue, u.qty]), [['pieces', 36, 3], ['packs', 120, 2]]);
});
