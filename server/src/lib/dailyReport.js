import { PAYMENT_METHODS, r2, r3 } from './money.js';
import { netSale } from './returns.js';
import { buildOverview, previousRange } from './analytics.js';

/**
 * Everything for the daily sales report, from plain records (pure, so it is unit tested).
 * Builds on the overview figures for that one day (compared with the day before) and adds the
 * full lists: every product sold (packs and loose pieces), every sale, every refund and debt payment,
 * and the cash the drawer should have taken in.
 */
export function buildDailyReport({ date, sales, prevSales = [], refunds = [], custPayments = [], products = [], users = [], customers = [] }) {
  const overview = buildOverview({ sales, prevSales, refunds, custPayments, products, users, from: date, to: date });
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const customerName = new Map(customers.map((c) => [String(c._id), c.name]));
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const nameOf = (id) => userName.get(String(id?._id ?? id ?? '')) || (id ? 'Former user' : '');

  // Every product sold, with how many full packs and how many loose pieces (net of returns).
  const items = new Map();
  for (const s of sales) {
    if (s.status === 'voided') continue;
    for (const it of s.items || []) {
      const rem = it.qty - (it.returnedQty || 0);
      if (rem <= 0) continue;
      const frac = it.qty > 0 ? rem / it.qty : 0;
      const id = String(it.product);
      const p = productById.get(id);
      const row = items.get(id) || {
        id, name: it.name, sku: it.sku, category: p?.category || '', packLabel: null,
        unitsPerPack: it.unitsPerPack || p?.unitsPerPack || 1, packs: 0, pieces: 0, qty: 0, revenue: 0, profit: 0,
      };
      // After a return, count what is left as whole packs first, then loose pieces (never "1.96 ctn").
      const upp = it.unitsPerPack || 1;
      const packs = it.packQty ? Math.min(it.packQty, Math.floor(r3(rem / upp))) : 0;
      const loose = r3(rem - packs * upp);
      const rev = it.lineTotal * frac;
      row.packs += packs; row.pieces += loose; row.qty += rem;
      row.revenue += rev; row.profit += rev - (it.costPrice || 0) * rem;
      if (packs && it.packLabel) row.packLabel = it.packLabel;
      items.set(id, row);
    }
  }
  const itemRows = [...items.values()]
    .map((r) => ({ ...r, packs: r3(r.packs), pieces: r3(r.pieces), qty: r3(r.qty), revenue: r2(r.revenue), profit: r2(r.profit) }))
    .sort((a, b) => b.revenue - a.revenue);

  // Every sale of the day, oldest first (the order they happened at the till).
  const saleRows = [...sales]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((s) => {
      const n = netSale(s);
      return {
        id: String(s._id), receiptNo: s.receiptNo, at: s.createdAt, status: s.status,
        cashier: nameOf(s.cashier), customer: s.customerName || '', customerPhone: s.customerPhone || '',
        itemCount: r3((s.items || []).reduce((t, i) => t + i.qty, 0)),
        total: r2(s.total), net: s.status === 'voided' ? 0 : n.net, discount: r2(s.discountTotal || 0),
        payments: (s.payments || []).map((p) => ({ method: p.method, amount: r2(p.amount) })),
        owed: n.credit, refunded: r2(s.refundedTotal || 0),
      };
    });

  const refundRows = [...refunds]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((r) => ({ at: r.createdAt, receiptNo: r.receiptNo || '', method: r.method, amount: r2(r.amount), reason: r.reason || '', by: nameOf(r.user) }));
  const debtRows = [...custPayments]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((p) => ({ at: p.createdAt, customer: customerName.get(String(p.customer)) || 'Former customer', method: p.method, amount: r2(p.amount), note: p.note || '', by: nameOf(p.user) }));

  // Cash the drawer should have taken in during the day (not counting any opening float).
  const sum = (list) => r2(list.reduce((t, x) => t + x.amount, 0));
  const cashSales = r2(sales.filter((s) => s.status !== 'voided' || s.refundedTotal != null)
    .reduce((t, s) => t + (s.payments || []).filter((p) => p.method === 'Cash').reduce((u, p) => u + p.amount, 0), 0));
  const cashDebts = sum(custPayments.filter((p) => p.method === 'Cash'));
  const cashRefunds = sum(refunds.filter((r) => r.method === 'Cash'));
  const voided = sales.filter((s) => s.status === 'voided');

  return {
    date,
    previousDate: previousRange(date, date).from,
    totals: overview.totals, previous: overview.previous, change: overview.change,
    byHour: overview.byHour, byMethod: overview.byMethod, cashiers: overview.cashiers, byUnit: overview.byUnit,
    totalReceived: r2(overview.byMethod.reduce((t, m) => t + m.amount, 0)),
    cash: { sales: cashSales, debts: cashDebts, refunds: cashRefunds, expected: r2(cashSales + cashDebts - cashRefunds) },
    items: itemRows, sales: saleRows, refunds: refundRows, debtPayments: debtRows,
    voided: { count: voided.length, total: r2(voided.reduce((t, s) => t + s.total, 0)) },
  };
}

const time = (d) => new Date(d).toISOString().slice(11, 16); // UTC = Ghana time

// Spreadsheet rows for the two downloads: one row per sale, or one row per product sold.
export function dailyCsv(report, part) {
  if (part === 'items') {
    return {
      header: ['Product', 'SKU', 'Category', 'Full packs', 'Pack size', 'Loose pieces', 'Total pieces', 'Revenue', 'Profit'],
      rows: report.items.map((r) => [r.name, r.sku, r.category, r.packs || '', r.unitsPerPack > 1 ? r.unitsPerPack : '', r.pieces, r.qty, r.revenue, r.profit]),
    };
  }
  return {
    header: ['Time', 'Receipt', 'Status', 'Cashier', 'Customer', 'Phone', 'Items', 'Total', 'Net after returns', 'Discount', ...PAYMENT_METHODS, 'Owed', 'Refunded'],
    rows: report.sales.map((s) => {
      const paid = (m) => r2(s.payments.filter((p) => p.method === m).reduce((t, p) => t + p.amount, 0)) || '';
      return [time(s.at), s.receiptNo, s.status, s.cashier, s.customer, s.customerPhone, s.itemCount, s.total, s.net, s.discount,
        ...PAYMENT_METHODS.map(paid), s.owed || '', s.refunded || ''];
    }),
  };
}
