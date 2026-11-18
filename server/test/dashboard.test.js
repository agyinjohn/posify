import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardExtras } from '../src/lib/dashboard.js';

test('dashboard: stock value, low and out of stock, debts, recent sales', () => {
  const d = dashboardExtras({
    products: [
      { _id: 'a', name: 'Rice', stock: 10, reorderLevel: 2, costPrice: 40, retailPrice: 55, active: true },
      { _id: 'b', name: 'Oil', stock: 1, reorderLevel: 3, costPrice: 90, retailPrice: 120, active: true },
      { _id: 'c', name: 'Dress', size: 'M', stock: 0, reorderLevel: 0, costPrice: 80, retailPrice: 150, active: true },
      { _id: 'd', name: 'Old', stock: 5, costPrice: 10, active: false },
    ],
    owing: [{ _id: 'x', name: 'Akos', balance: 120.5 }, { _id: 'y', name: 'Yaw', balance: 30 }],
    recent: [{ _id: 's', receiptNo: 'R-1', createdAt: 't', total: 50, status: 'completed', cashier: 'u', payments: [{ method: 'Cash' }, { method: 'Cash' }, { method: 'MoMo' }] }],
    users: [{ _id: 'u', name: 'Ama' }],
    customerCount: 9,
  });
  assert.equal(d.stock.products, 3);
  assert.equal(d.stock.value, 490);         // 10×40 + 1×90 + 0
  assert.equal(d.stock.retailValue, 670);
  assert.deepEqual([d.stock.lowCount, d.stock.outCount], [1, 1]);
  assert.deepEqual(d.stock.low.map((p) => p.name), ['Dress (M)', 'Oil']); // emptiest first
  assert.deepEqual([d.debt.total, d.debt.customers], [150.5, 2]);
  assert.deepEqual(d.recentSales[0].methods, ['Cash', 'MoMo']);
  assert.equal(d.recentSales[0].cashier, 'Ama');
});
