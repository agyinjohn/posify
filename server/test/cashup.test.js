import test from 'node:test';
import assert from 'node:assert/strict';
import { cashUp } from '../src/lib/cashup.js';
import { buildStatement, netMovement } from '../src/lib/statement.js';

const sale = (over = {}) => ({
  status: 'completed', total: 100, subtotal: 100, orderDiscount: 0, discountTotal: 0, balance: 0, creditReturned: 0, refundedTotal: 0,
  payments: [{ method: 'Cash', amount: 100 }],
  items: [{ qty: 1, lineTotal: 100, costPrice: 60, returnedQty: 0 }],
  ...over,
});

test('cash-up: expected cash is float plus cash taken, and variance compares the count to it', () => {
  const r = cashUp({ sales: [sale(), sale({ payments: [{ method: 'MoMo', amount: 100 }] })], openingFloat: 50, closingCash: 140 });
  assert.equal(r.byMethod.Cash, 100);
  assert.equal(r.byMethod.MoMo, 100);
  assert.equal(r.expectedCash, 150);
  assert.equal(r.cashVariance, -10);
  assert.equal(r.salesCount, 2);
});

test('cash-up: a refund comes out of the method it was paid back by', () => {
  const returned = sale({ status: 'partial-return', refundedTotal: 40, items: [{ qty: 1, lineTotal: 100, costPrice: 60, returnedQty: 0.4 }] });
  const r = cashUp({ sales: [returned], refunds: [{ method: 'Cash', amount: 40 }], openingFloat: 0, closingCash: 60 });
  assert.equal(r.byMethod.Cash, 60);
  assert.equal(r.refunded, 40);
  assert.equal(r.total, 60);
  assert.equal(r.cashVariance, 0);
});

test('cash-up: a voided sale nets to zero, and a legacy void (no refund tracking) is skipped', () => {
  const voided = sale({ status: 'voided', refundedTotal: 100, items: [{ qty: 1, lineTotal: 100, costPrice: 60, returnedQty: 1 }] });
  const legacy = { ...sale({ status: 'voided' }), refundedTotal: undefined };
  const r = cashUp({ sales: [voided, legacy], refunds: [{ method: 'Cash', amount: 100 }], openingFloat: 0, closingCash: 0 });
  assert.equal(r.byMethod.Cash, 0);
  assert.equal(r.salesCount, 0);
  assert.equal(r.total, 0);
});

test('cash-up: debt payments count, credit given excludes credit cancelled by returns', () => {
  const credit = sale({ balance: 60, payments: [{ method: 'Cash', amount: 40 }], creditReturned: 20 });
  const r = cashUp({ sales: [credit], custPayments: [{ method: 'Cash', amount: 15 }], openingFloat: 0 });
  assert.equal(r.creditGiven, 40);
  assert.equal(r.debtCollected, 15);
  assert.equal(r.byMethod.Cash, 55);
  assert.equal(r.cashVariance, null); // no closing count given
});

const d = (n) => new Date(2026, 0, n);
test('statement: credit sale, return credit and payment give a running balance', () => {
  const r = buildStatement({
    currentBalance: 30,
    sales: [{ receiptNo: 'R1', balance: 100, status: 'partial-return', creditReturned: 40, createdAt: d(1) }],
    notes: [{ receiptNo: 'R1', amount: 40, createdAt: d(2) }],
    payments: [{ method: 'Cash', amount: 30, createdAt: d(3) }],
  });
  assert.equal(r.openingBalance, 0);
  assert.deepEqual(r.statement.map((x) => x.balance), [100, 60, 30]);
  assert.equal(r.closingBalance, 30);
});

test('statement: legacy voided or partly returned sales (no tracked credit) are left out', () => {
  const r = buildStatement({
    currentBalance: 0,
    sales: [{ receiptNo: 'OLD', balance: 50, status: 'voided', createdAt: d(1) }, { receiptNo: 'OLD2', balance: 50, status: 'partial-return', createdAt: d(1) }],
  });
  assert.equal(r.statement.length, 0);
});

test('statement: opening balance accounts for activity after the period', () => {
  const later = netMovement({ sales: [{ balance: 25, status: 'completed' }], payments: [{ amount: 5 }] }); // +20 after
  const r = buildStatement({ currentBalance: 120, afterNet: later, sales: [{ receiptNo: 'R9', balance: 50, status: 'completed', createdAt: d(1) }] });
  assert.equal(r.openingBalance, 50); // 120 - 20 - 50
  assert.equal(r.closingBalance, 100);
});
