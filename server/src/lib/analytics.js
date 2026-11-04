import { PAYMENT_METHODS, r2, r3 } from './money.js';
import { netSale } from './returns.js';

/**
 * Figures for the Reports overview, computed from plain sale records (pure, so it is unit tested).
 * Money is net of returns and voids, the same way the daily report and shift cash-up count it.
 * Days and hours are UTC, which is local time in Ghana (see dayRange in validate.js).
 */

const DAY = 86_400_000;
export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// Voids from before refunds were tracked have no refundedTotal and were never counted; keep it that way.
const counts = (s) => s.status !== 'voided' || s.refundedTotal != null;

const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export function summarize(sales) {
  let revenue = 0, profit = 0, count = 0, items = 0, discounts = 0, credit = 0;
  for (const s of sales) {
    if (!counts(s)) continue;
    const n = netSale(s);
    revenue += n.net; profit += n.profit; credit += n.credit;
    if (s.status !== 'voided') {
      count += 1;
      discounts += s.discountTotal || 0;
      for (const it of s.items || []) items += it.qty - (it.returnedQty || 0);
    }
  }
  revenue = r2(revenue); profit = r2(profit);
  return {
    revenue, profit, salesCount: count, itemsSold: r3(items), discounts: r2(discounts), creditGiven: r2(credit),
    avgSale: count ? r2(revenue / count) : 0,
    margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
  };
}

// Keep the biggest n and fold the rest into one "Other" row, so a chart never needs more than n+1 colours/bars.
export function topWithOther(rows, n, key = 'revenue') {
  const sorted = [...rows].sort((a, b) => b[key] - a[key]);
  if (sorted.length <= n + 1) return sorted;
  const rest = sorted.slice(n);
  const other = { name: `Other (${rest.length})`, other: true };
  for (const k of Object.keys(rest[0])) if (typeof rest[0][k] === 'number') other[k] = r2(rest.reduce((t, r) => t + (r[k] || 0), 0));
  return [...sorted.slice(0, n), other];
}

export function buildOverview({ sales, prevSales = [], refunds = [], custPayments = [], products = [], users = [], from, to }) {
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const live = sales.filter(counts);

  const totals = summarize(sales);
  const previous = summarize(prevSales);
  const change = {
    revenue: pct(totals.revenue, previous.revenue), profit: pct(totals.profit, previous.profit),
    salesCount: pct(totals.salesCount, previous.salesCount), avgSale: pct(totals.avgSale, previous.avgSale),
  };

  // Per day, hour of day and weekday.
  const daily = new Map(daysBetween(from, to).map((d) => [d, { date: d, revenue: 0, profit: 0, sales: 0 }]));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, sales: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, d) => ({ day: d, revenue: 0, sales: 0 }));
  const products_ = new Map();
  const categories = new Map();
  const cashiers = new Map();
  // How it was bought: single pieces (retail price) or full packs (wholesale price).
  const byUnit = { pieces: { revenue: 0, qty: 0 }, packs: { revenue: 0, qty: 0 } };
  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));

  for (const s of live) {
    const n = netSale(s);
    const at = new Date(s.createdAt);
    const isSale = s.status !== 'voided';
    const day = daily.get(dayKey(at));
    if (day) { day.revenue += n.net; day.profit += n.profit; if (isSale) day.sales += 1; }
    byHour[at.getUTCHours()].revenue += n.net; if (isSale) byHour[at.getUTCHours()].sales += 1;
    byWeekday[at.getUTCDay()].revenue += n.net; if (isSale) byWeekday[at.getUTCDay()].sales += 1;
    for (const p of s.payments || []) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;

    const cid = String(s.cashier?._id ?? s.cashier ?? '');
    const c = cashiers.get(cid) || { name: userById.get(cid)?.name || 'Former user', revenue: 0, sales: 0 };
    c.revenue += n.net; if (isSale) c.sales += 1; cashiers.set(cid, c);

    for (const it of s.items || []) {
      const rem = it.qty - (it.returnedQty || 0);
      if (rem <= 0) continue;
      const frac = it.qty > 0 ? rem / it.qty : 0;
      const rev = it.lineTotal * frac;
      const prof = rev - (it.costPrice || 0) * rem;
      const id = String(it.product);
      const row = products_.get(id) || { id, name: it.name, sku: it.sku, qty: 0, revenue: 0, profit: 0 };
      row.qty += rem; row.revenue += rev; row.profit += prof; products_.set(id, row);
      // Split the line's money between the packs and the loose pieces in it, in proportion to their prices.
      const packs = it.packQty || 0;
      const loose = it.loosePcs ?? (packs ? 0 : it.qty);
      const packGross = packs ? packs * (it.packPrice ?? (it.unitPrice || 0) * (it.unitsPerPack || 1)) : 0;
      const looseGross = loose * (it.unitPrice || 0);
      const share = packGross + looseGross > 0 ? packGross / (packGross + looseGross) : (packs ? 1 : 0);
      byUnit.packs.revenue += rev * share; byUnit.packs.qty += packs * frac;
      byUnit.pieces.revenue += rev * (1 - share); byUnit.pieces.qty += loose * frac;
      const cat = productById.get(id)?.category || 'Uncategorised';
      const cr = categories.get(cat) || { name: cat, revenue: 0, profit: 0 };
      cr.revenue += rev; cr.profit += prof; categories.set(cat, cr);
    }
  }
  for (const p of custPayments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
  for (const rf of refunds) byMethod[rf.method] = (byMethod[rf.method] || 0) - rf.amount;

  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && k !== 'hour' && k !== 'day' ? r2(v) : v]));
  const productRows = [...products_.values()].map((p) => ({ ...round(p), qty: r3(p.qty), margin: p.revenue > 0 ? Math.round((p.profit / p.revenue) * 1000) / 10 : null }));

  // Stock that did not sell at all in the period, biggest money tied up first.
  const sold = new Set(products_.keys());
  const idle = products
    .filter((p) => p.active !== false && p.stock > 0 && !sold.has(String(p._id)))
    .map((p) => ({ id: String(p._id), name: p.name, sku: p.sku, stock: p.stock, value: r2(p.stock * (p.costPrice || 0)) }))
    .sort((a, b) => b.value - a.value);

  return {
    from, to,
    totals: { ...totals, debtCollected: r2(custPayments.reduce((t, p) => t + p.amount, 0)), refunded: r2(refunds.reduce((t, r) => t + r.amount, 0)) },
    previous, change,
    daily: [...daily.values()].map(round),
    byHour: byHour.map(round),
    byWeekday: byWeekday.map(round),
    byMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
    topProducts: [...productRows].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    topProfit: [...productRows].sort((a, b) => b.profit - a.profit).slice(0, 10),
    productsSold: productRows.length,
    categories: topWithOther([...categories.values()].map(round), 6),
    cashiers: [...cashiers.values()].map(round).sort((a, b) => b.revenue - a.revenue),
    byUnit: Object.entries(byUnit).map(([unit, v]) => ({ unit, revenue: r2(v.revenue), qty: r3(v.qty) })),
    idleStock: { count: idle.length, value: r2(idle.reduce((t, p) => t + p.value, 0)), top: idle.slice(0, 8) },
  };
}

// The period of the same length that ends just before `from` (for "vs previous period").
export function previousRange(from, to) {
  const len = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) + DAY;
  const prevTo = new Date(Date.parse(`${from}T00:00:00Z`) - DAY);
  const prevFrom = new Date(prevTo.getTime() - len + DAY);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}
