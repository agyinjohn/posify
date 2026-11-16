import test from 'node:test';
import assert from 'node:assert/strict';
import { planStockRestore } from '../src/lib/clearSales.js';

test('clearing sales puts back exactly what sales took out, net of voids and returns', () => {
  const plan = planStockRestore([
    { product: 'a', type: 'sale', qty: -24 },
    { product: 'a', type: 'sale', qty: -3 },
    { product: 'a', type: 'return', qty: 2 },
    { product: 'b', type: 'sale', qty: -5 },
    { product: 'b', type: 'void', qty: 5 },        // voided: nothing to put back
    { product: 'c', type: 'receipt', qty: 100 },   // deliveries and adjustments are not sales: left alone
    { product: 'c', type: 'adjustment', qty: -4 },
    { product: 'd', type: 'sale', qty: -0.5 },
  ]);
  assert.deepEqual(plan, [{ product: 'a', qty: 25 }, { product: 'd', qty: 0.5 }]);
});

test('clearing sales before a date takes off exactly what those records did to each balance', async () => {
  const { planBalanceChanges, cutoffDate } = await import('../src/lib/clearSales.js');
  const plan = planBalanceChanges({
    sales: [{ customer: 'c1', balance: 100 }, { customer: 'c1', balance: 50 }, { customer: 'c2', balance: 30 }, { customer: null, balance: 0 }],
    creditNotes: [{ customer: 'c1', amount: 20 }],   // returned goods had already taken 20 off c1
    payments: [{ customer: 'c1', amount: 60 }, { customer: 'c2', amount: 30 }], // c2 paid its test debt in full
  });
  assert.deepEqual(plan, [{ customer: 'c1', delta: -70 }]); // c1 owed 150 − 20 − 60 = 70 from these records; c2 nets to 0
  assert.equal(cutoffDate(''), null);
  assert.equal(cutoffDate('2026-11-10').toISOString(), '2026-11-10T00:00:00.000Z');
  assert.throws(() => cutoffDate('10/11/2026'), /valid date/);
});
