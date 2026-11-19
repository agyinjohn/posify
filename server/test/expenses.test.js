import test from 'node:test';
import assert from 'node:assert/strict';
import { profitAndLoss, byCategory, sumExpenses } from '../src/lib/expenses.js';
import { cashUp } from '../src/lib/cashup.js';
import { buildDailyReport } from '../src/lib/dailyReport.js';

const sale = (at, total, cost, o = {}) => ({
  createdAt: new Date(at), status: 'completed', total, subtotal: total, orderDiscount: 0, discountTotal: 0, balance: 0, creditReturned: 0, refundedTotal: 0,
  cashier: 'u', payments: [{ method: 'Cash', amount: total }], items: [{ product: 'p', name: 'X', qty: 1, returnedQty: 0, lineTotal: total, costPrice: cost }], ...o,
});
const exp = (d, amount, category = 'Rent', o = {}) => ({ date: new Date(`${d}T12:00:00Z`), amount, category, method: 'Cash', ...o });

test('profit and loss: gross profit less expenses is net profit, compared with the period before', () => {
  const pl = profitAndLoss({
    from: '2026-11-01', to: '2026-11-03',
    sales: [sale('2026-11-01T10:00Z', 1000, 700), sale('2026-11-03T15:00Z', 500, 300)],
    prevSales: [sale('2026-10-30T10:00Z', 800, 600)],
    expenses: [exp('2026-11-01', 150), exp('2026-11-02', 50, 'Transport and fuel'), exp('2026-11-02', 25, 'Transport and fuel')],
    prevExpenses: [exp('2026-10-29', 100)],
  });
  assert.deepEqual([pl.revenue, pl.costOfGoods, pl.grossProfit, pl.expenses, pl.netProfit], [1500, 1000, 500, 225, 275]);
  assert.equal(pl.grossMargin, 33.3);
  assert.equal(pl.netMargin, 18.3);
  assert.equal(pl.previous.netProfit, 100);
  assert.equal(pl.change.netProfit, 175);
  assert.deepEqual(pl.byCategory, [{ category: 'Rent', amount: 150 }, { category: 'Transport and fuel', amount: 75 }]);
  assert.deepEqual(pl.series.map((d) => [d.period, d.revenue, d.expenses, d.netProfit]), [['2026-11-01', 1000, 150, 150], ['2026-11-02', 0, 75, -75], ['2026-11-03', 500, 0, 200]]);
  assert.equal(pl.monthly, false);
  assert.equal(profitAndLoss({ from: '2026-01-01', to: '2026-06-30' }).series.length, 6, 'long ranges go by month');
});

test('a loss shows as a negative net profit; no percentage against a loss', () => {
  const pl = profitAndLoss({ from: '2026-11-01', to: '2026-11-01', sales: [sale('2026-11-01T10:00Z', 100, 80)], expenses: [exp('2026-11-01', 50)], prevSales: [], prevExpenses: [exp('2026-10-31', 10)] });
  assert.equal(pl.netProfit, -30);
  assert.equal(pl.change.netProfit, null);
  assert.equal(sumExpenses([]), 0);
  assert.deepEqual(byCategory([]), []);
});

test('cash taken from the till for expenses comes off the expected cash (cash-up and daily report)', () => {
  const sales = [sale('2026-11-01T10:00Z', 300, 200)];
  const expenses = [exp('2026-11-01', 40, 'Transport and fuel', { fromTill: true }), exp('2026-11-01', 500, 'Rent', { method: 'Transfer' })];
  const c = cashUp({ sales, expenses, openingFloat: 100, closingCash: 360 });
  assert.equal(c.expectedCash, 360);
  assert.equal(c.paidOut, 40);
  assert.equal(c.cashVariance, 0);
  const d = buildDailyReport({ date: '2026-11-01', sales, expenses });
  assert.equal(d.cash.expected, 260);
  assert.equal(d.cash.paidOut, 40);
  assert.equal(d.expenseTotal, 540);
  assert.equal(d.netProfit, 100 - 540);
  assert.equal(d.expenses.length, 2);
});
