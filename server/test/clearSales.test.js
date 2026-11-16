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
