import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReport, dailyCsv } from '../src/lib/dailyReport.js';

const sale = (o = {}) => ({
  _id: 's1', receiptNo: 'R-1', createdAt: '2026-11-05T09:30:00Z', status: 'completed', total: 100, subtotal: 100, orderDiscount: 0, discountTotal: 0,
  balance: 0, creditReturned: 0, refundedTotal: 0, cashier: 'u1', payments: [{ method: 'Cash', amount: 100 }],
  items: [{ product: 'p1', name: 'Rice', sku: 'R', qty: 2, returnedQty: 0, lineTotal: 100, costPrice: 30 }],
  ...o,
});
const users = [{ _id: 'u1', name: 'Ama' }, { _id: 'u2', name: 'Kofi' }];
const products = [{ _id: 'p1', name: 'Rice', sku: 'R', category: 'Grains', stock: 5, costPrice: 30 }, { _id: 'p2', name: 'Malt', sku: 'M', category: 'Drinks', unitsPerPack: 24 }];

test('daily report: totals vs the day before, cash expected, lists in till order', () => {
  const r = buildDailyReport({
    date: '2026-11-05', users, products, customers: [{ _id: 'c1', name: 'Yaw' }],
    sales: [
      sale({ _id: 's2', receiptNo: 'R-2', createdAt: '2026-11-05T15:00:00Z', cashier: 'u2', total: 60, payments: [{ method: 'MoMo', amount: 40 }], balance: 20, customerName: 'Yaw',
        items: [{ product: 'p1', name: 'Rice', qty: 1, lineTotal: 60, costPrice: 30 }] }),
      sale(),
    ],
    prevSales: [sale({ createdAt: '2026-11-04T10:00:00Z' })],
    refunds: [{ createdAt: '2026-11-05T16:00:00Z', receiptNo: 'R-1', method: 'Cash', amount: 10, reason: 'Torn bag', user: 'u1' }],
    custPayments: [{ createdAt: '2026-11-05T12:00:00Z', customer: 'c1', method: 'Cash', amount: 25, user: 'u2' }],
  });
  assert.equal(r.previousDate, '2026-11-04');
  assert.equal(r.totals.revenue, 160);
  assert.equal(r.change.revenue, 60);
  assert.deepEqual(r.cash, { sales: 100, debts: 25, refunds: 10, expected: 115 });
  assert.equal(r.totalReceived, 155); // 100 cash + 40 MoMo + 25 debt − 10 refund
  assert.deepEqual(r.sales.map((s) => [s.receiptNo, s.cashier, s.owed]), [['R-1', 'Ama', 0], ['R-2', 'Kofi', 20]]);
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.revenue, i.profit]), [['Rice', 3, 160, 70]]);
  assert.deepEqual(r.refunds[0], { at: '2026-11-05T16:00:00Z', receiptNo: 'R-1', method: 'Cash', amount: 10, reason: 'Torn bag', by: 'Ama' });
  assert.equal(r.debtPayments[0].customer, 'Yaw');
  assert.equal(r.debtPayments[0].by, 'Kofi');
});

test('daily report: packs and loose pieces counted separately, net of returns; voids listed but not counted', () => {
  const r = buildDailyReport({
    date: '2026-11-05', users, products,
    sales: [
      sale({ items: [{ product: 'p2', name: 'Malt', qty: 51, returnedQty: 0, packQty: 2, loosePcs: 3, packLabel: 'ctn', unitsPerPack: 24, lineTotal: 300, costPrice: 4, packPrice: 135, unitPrice: 10 }], total: 300 }),
      sale({ _id: 's3', receiptNo: 'R-3', status: 'voided', refundedTotal: 100, items: [{ product: 'p1', name: 'Rice', qty: 2, returnedQty: 2, lineTotal: 100, costPrice: 30 }] }),
    ],
  });
  assert.deepEqual(r.items.map((i) => [i.name, i.packs, i.pieces, i.qty, i.packLabel, i.unitsPerPack]), [['Malt', 2, 3, 51, 'ctn', 24]]);
  assert.deepEqual(r.voided, { count: 1, total: 100 });
  const back = buildDailyReport({ date: '2026-11-05', users, products, sales: [sale({ status: 'partial-return', items: [{ product: 'p2', name: 'Malt', qty: 51, returnedQty: 4, packQty: 2, loosePcs: 3, unitsPerPack: 24, lineTotal: 300, costPrice: 4 }] })] });
  assert.deepEqual([back.items[0].packs, back.items[0].pieces, back.items[0].qty], [1, 23, 47]); // 47 left = 1 pack + 23 pieces
  assert.equal(r.sales.find((s) => s.receiptNo === 'R-3').net, 0);
  assert.equal(r.totals.salesCount, 1);
});

test('daily report downloads: one row per sale or per product', () => {
  const r = buildDailyReport({ date: '2026-11-05', users, products, sales: [sale({ payments: [{ method: 'Cash', amount: 60 }, { method: 'MoMo', amount: 40 }] })] });
  const s = dailyCsv(r, 'sales');
  assert.equal(s.header[0], 'Time');
  assert.deepEqual(s.rows[0].slice(0, 4), ['09:30', 'R-1', 'completed', 'Ama']);
  assert.equal(s.rows[0][s.header.indexOf('Cash')], 60);
  assert.equal(s.rows[0][s.header.indexOf('MoMo')], 40);
  assert.equal(s.rows[0][s.header.indexOf('Card')], '');
  const i = dailyCsv(r, 'items');
  assert.deepEqual(i.rows[0], ['Rice', 'R', 'Grains', '', '', 2, 2, 100, 40]);
});
