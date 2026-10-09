import { Router } from 'express';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import CustomerPayment from '../models/CustomerPayment.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { dayRange } from '../lib/validate.js';
import { PAYMENT_METHODS, r2 } from '../lib/money.js';
import { toCsv } from '../lib/csv.js';

const router = Router();
router.use(requireAuth, requireOwner);

const saleProfit = (s) =>
  s.items.reduce((sum, it) => sum + it.lineTotal - it.costPrice * it.qty, 0) - (s.orderDiscount || 0);

// Daily cash-up style summary, split by how customers paid.
router.get('/daily', asyncHandler(async (req, res) => {
  const { start, end, from } = dayRange(req.query.date, req.query.date);
  const [sales, voided, custPayments] = await Promise.all([
    Sale.find({ createdAt: { $gte: start, $lt: end }, status: 'completed' }).lean(),
    Sale.find({ createdAt: { $gte: start, $lt: end }, status: 'voided' }).select('total').lean(),
    CustomerPayment.find({ createdAt: { $gte: start, $lt: end } }).lean(),
  ]);

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));
  let total = 0, discounts = 0, profit = 0, creditGiven = 0;
  for (const s of sales) {
    total += s.total; discounts += s.discountTotal || 0; profit += saleProfit(s); creditGiven += s.balance || 0;
    for (const p of s.payments) byMethod[p.method] += p.amount;
  }
  let debtCollected = 0;
  for (const p of custPayments) { byMethod[p.method] += p.amount; debtCollected += p.amount; }

  res.json({
    date: from,
    salesCount: sales.length,
    total: r2(total),
    discounts: r2(discounts),
    profit: r2(profit),
    creditGiven: r2(creditGiven),
    debtCollected: r2(debtCollected),
    byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, r2(v)])),
    voidedCount: voided.length,
    voidedTotal: r2(voided.reduce((s, v) => s + v.total, 0)),
  });
}));

router.get('/by-product', asyncHandler(async (req, res) => {
  const { start, end, from, to } = dayRange(req.query.from, req.query.to);
  const sales = await Sale.find({ createdAt: { $gte: start, $lt: end }, status: 'completed' }).select('items').lean();
  const map = new Map();
  for (const s of sales) {
    for (const it of s.items) {
      const key = String(it.product);
      const row = map.get(key) || { product: key, name: it.name, sku: it.sku, qty: 0, revenue: 0, profit: 0 };
      row.qty += it.qty; row.revenue += it.lineTotal; row.profit += it.lineTotal - it.costPrice * it.qty;
      map.set(key, row);
    }
  }
  const rows = [...map.values()].map((r) => ({ ...r, qty: r2(r.qty), revenue: r2(r.revenue), profit: r2(r.profit) }))
    .sort((a, b) => b.revenue - a.revenue);
  res.json({ from, to, rows });
}));

router.get('/stock', asyncHandler(async (req, res) => {
  const products = await Product.find({ active: true }).sort({ name: 1 }).lean();
  const rows = products.map((p) => ({
    name: p.name, sku: p.sku, category: p.category, stock: p.stock, reorderLevel: p.reorderLevel,
    costPrice: p.costPrice, retailPrice: p.retailPrice, wholesalePrice: p.wholesalePrice,
    value: r2(p.stock * p.costPrice), low: p.stock <= p.reorderLevel,
  }));
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stock.csv"');
    return res.send(toCsv(
      ['Name', 'SKU', 'Category', 'In stock', 'Reorder level', 'Cost', 'Retail', 'Wholesale', 'Stock value', 'Low'],
      rows.map((r) => [r.name, r.sku, r.category, r.stock, r.reorderLevel, r.costPrice, r.retailPrice, r.wholesalePrice, r.value, r.low ? 'Yes' : 'No']),
    ));
  }
  res.json({ totalValue: r2(rows.reduce((s, r) => s + r.value, 0)), rows });
}));

export default router;
