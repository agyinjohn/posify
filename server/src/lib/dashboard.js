import { r2 } from './money.js';
import { productLabel } from './productLabel.js';

// The "needs attention now" part of the dashboard, from plain records (pure, unit tested).
export function dashboardExtras({ products = [], owing = [], recent = [], users = [], customerCount = 0 }) {
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const live = products.filter((p) => p.active !== false);
  const low = live.filter((p) => p.stock <= (p.reorderLevel || 0))
    .sort((a, b) => a.stock - b.stock || productLabel(a).localeCompare(productLabel(b)));
  return {
    stock: {
      products: live.length,
      value: r2(live.reduce((t, p) => t + Math.max(p.stock, 0) * (p.costPrice || 0), 0)),
      retailValue: r2(live.reduce((t, p) => t + Math.max(p.stock, 0) * (p.retailPrice || 0), 0)),
      lowCount: low.filter((p) => p.stock > 0).length,
      outCount: low.filter((p) => p.stock <= 0).length,
      low: low.slice(0, 8).map((p) => ({ id: String(p._id), name: productLabel(p), sku: p.sku, stock: p.stock, reorderLevel: p.reorderLevel || 0, image: p.image?.url || null })),
    },
    debt: {
      total: r2(owing.reduce((t, c) => t + c.balance, 0)),
      customers: owing.length,
      top: owing.slice(0, 5).map((c) => ({ id: String(c._id), name: c.name, balance: r2(c.balance) })),
    },
    customerCount,
    recentSales: recent.map((s) => ({
      id: String(s._id), receiptNo: s.receiptNo, at: s.createdAt, total: r2(s.total), status: s.status,
      customer: s.customerName || '', owed: r2(s.balance || 0), cashier: userName.get(String(s.cashier)) || '',
      methods: [...new Set((s.payments || []).map((p) => p.method))],
    })),
  };
}
