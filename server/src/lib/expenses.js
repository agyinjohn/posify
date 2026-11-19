import { r2 } from './money.js';
import { summarize, daysBetween, dayKey } from './analytics.js';

/**
 * Expenses and the profit and loss statement. Pure, so it is unit tested (test/expenses.test.js).
 * Revenue and gross profit come from summarize() (net of returns and discounts, as everywhere else);
 * net profit = gross profit − expenses.
 */
export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries and wages', 'Transport and fuel', 'Electricity and water', 'Airtime and data', 'Shop supplies',
  'Repairs and maintenance', 'Taxes and levies', 'Bank and MoMo charges', 'Marketing', 'Security', 'Other',
];

export const sumExpenses = (list) => r2(list.reduce((t, e) => t + (e.amount || 0), 0));

export function byCategory(list) {
  const m = new Map();
  for (const e of list) m.set(e.category, r2((m.get(e.category) || 0) + e.amount));
  return [...m].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const margin = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const monthKey = (d) => dayKey(d).slice(0, 7);

/**
 * The statement for a period, the same for the period before (for "vs before"), and a series by day (up to
 * 62 days) or by month. Sales are bucketed by sale date, expenses by the date they were paid.
 */
export function profitAndLoss({ sales = [], prevSales = [], expenses = [], prevExpenses = [], from, to }) {
  const statement = (s, e) => {
    const t = summarize(s);
    const cost = r2(t.revenue - t.profit);
    const exp = sumExpenses(e);
    const net = r2(t.profit - exp);
    return {
      revenue: t.revenue, costOfGoods: cost, grossProfit: t.profit, expenses: exp, netProfit: net,
      grossMargin: margin(t.profit, t.revenue), netMargin: margin(net, t.revenue), salesCount: t.salesCount,
    };
  };
  const now = statement(sales, expenses);
  const before = statement(prevSales, prevExpenses);

  const days = daysBetween(from, to);
  const monthly = days.length > 62;
  const keys = monthly ? [...new Set(days.map((d) => d.slice(0, 7)))] : days;
  const series = new Map(keys.map((k) => [k, { period: k, sales: [], expenses: 0 }]));
  const keyOf = (d) => (monthly ? monthKey(d) : dayKey(d));
  for (const s of sales) series.get(keyOf(s.createdAt))?.sales.push(s);
  for (const e of expenses) { const b = series.get(keyOf(e.date)); if (b) b.expenses += e.amount; }

  return {
    from, to, monthly,
    ...now,
    previous: before,
    change: { revenue: pct(now.revenue, before.revenue), grossProfit: pct(now.grossProfit, before.grossProfit), expenses: pct(now.expenses, before.expenses), netProfit: before.netProfit > 0 ? pct(now.netProfit, before.netProfit) : null },
    byCategory: byCategory(expenses),
    series: [...series.values()].map((b) => {
      const t = summarize(b.sales);
      return { period: b.period, revenue: t.revenue, grossProfit: t.profit, expenses: r2(b.expenses), netProfit: r2(t.profit - b.expenses) };
    }),
  };
}
