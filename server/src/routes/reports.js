import { Router } from 'express';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import CustomerPayment from '../models/CustomerPayment.js';
import Refund from '../models/Refund.js';
import { netSale } from '../lib/returns.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { dayRange } from '../lib/validate.js';
import { PAYMENT_METHODS, r2 } from '../lib/money.js';
import { toCsv } from '../lib/csv.js';
import User from '../models/User.js';
import { buildOverview, previousRange } from '../lib/analytics.js';
import { packPriceFor } from '../lib/unitPrices.js';
import { buildDailyReport, dailyCsv } from '../lib/dailyReport.js';
import Customer from '../models/Customer.js';
import { productLabel } from '../lib/productLabel.js';

const router = Router();
router.use(requireAuth, requireOwner);

// Daily cash-up style summary, split by how customers paid.
router.get('/daily', asyncHandler(async (req, res) => {
  const { start, end, from } = dayRange(req.query.date, req.query.date);
  const [allSales, voided, custPayments, refunds] = await Promise.all([
    Sale.find({ createdAt: { $gte: start, $lt: end } }).lean(),
    Sale.find({ createdAt: { $gte: start, $lt: end }, status: 'voided' }).select('total').lean(),
    CustomerPayment.find({ createdAt: { $gte: start, $lt: end } }).lean(),
    Refund.find({ createdAt: { $gte: start, $lt: end } }).lean(),
  ]);
  // Voids made before refunds were tracked (no refundedTotal) stay excluded, as before.
  const sales = allSales.filter((s) => s.status !== 'voided' || s.refundedTotal != null);

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));
  let total = 0, discounts = 0, profit = 0, creditGiven = 0;
  for (const s of sales) {
    const n = netSale(s);
    total += n.net; discounts += s.discountTotal || 0; profit += n.profit; creditGiven += n.credit;
    for (const p of s.payments) byMethod[p.method] += p.amount;
  }
  let refunded = 0;
  for (const rf of refunds) { byMethod[rf.method] -= rf.amount; refunded += rf.amount; }
  let debtCollected = 0;
  for (const p of custPayments) { byMethod[p.method] += p.amount; debtCollected += p.amount; }

  res.json({
    date: from,
    salesCount: sales.filter((s) => s.status !== 'voided').length,
    total: r2(total),
    discounts: r2(discounts),
    profit: r2(profit),
    creditGiven: r2(creditGiven),
    debtCollected: r2(debtCollected),
    refunded: r2(refunded),
    byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, r2(v)])),
    voidedCount: voided.length,
    voidedTotal: r2(voided.reduce((s, v) => s + v.total, 0)),
  });
}));

router.get('/by-product', asyncHandler(async (req, res) => {
  const { start, end, from, to } = dayRange(req.query.from, req.query.to);
  const sales = await Sale.find({ createdAt: { $gte: start, $lt: end }, status: { $in: ['completed', 'partial-return'] } }).select('items').lean();
  const map = new Map();
  for (const s of sales) {
    for (const it of s.items) {
      const key = String(it.product);
      const row = map.get(key) || { product: key, name: it.name, sku: it.sku, qty: 0, revenue: 0, profit: 0 };
      const rem = it.qty - (it.returnedQty || 0); // returned units no longer count as sold
      const frac = it.qty > 0 ? rem / it.qty : 0;
      row.qty += rem; row.revenue += it.lineTotal * frac; row.profit += it.lineTotal * frac - it.costPrice * rem;
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
    name: productLabel(p), sku: p.sku, category: p.category, stock: p.stock, reorderLevel: p.reorderLevel,
    costPrice: p.costPrice, retailPrice: p.retailPrice, packPrice: (p.unitsPerPack > 1 ? packPriceFor(p) : null), unitsPerPack: p.unitsPerPack || 1,
    value: r2(p.stock * p.costPrice), low: p.stock <= p.reorderLevel,
  }));
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stock.csv"');
    return res.send(toCsv(
      ['Name', 'SKU', 'Category', 'In stock (pieces)', 'Reorder level', 'Cost per piece', 'Price per piece', 'Pieces per pack', 'Price per pack', 'Stock value', 'Low'],
      rows.map((r) => [r.name, r.sku, r.category, r.stock, r.reorderLevel, r.costPrice, r.retailPrice, r.unitsPerPack > 1 ? r.unitsPerPack : '', r.packPrice ?? '', r.value, r.low ? 'Yes' : 'No']),
    ));
  }
  res.json({ totalValue: r2(rows.reduce((s, r) => s + r.value, 0)), rows });
}));

// Overview for a date range: totals vs the previous period of the same length, trends by day / hour / weekday,
// payment methods, best products, categories, cashiers, retail vs wholesale, and stock that did not sell.
const SALE_FIELDS = 'createdAt status mode total subtotal orderDiscount discountTotal balance creditReturned refundedTotal payments cashier items.product items.name items.sku items.qty items.returnedQty items.lineTotal items.costPrice items.packQty items.loosePcs items.packPrice items.unitPrice items.unitsPerPack';
router.get('/overview', asyncHandler(async (req, res) => {
  const { start, end, from, to } = dayRange(req.query.from, req.query.to);
  const prev = previousRange(from, to);
  const prevStart = new Date(`${prev.from}T00:00:00.000Z`);
  const [allSales, refunds, custPayments, products, users] = await Promise.all([
    Sale.find({ createdAt: { $gte: prevStart, $lt: end } }).select(SALE_FIELDS).lean(),
    Refund.find({ createdAt: { $gte: start, $lt: end } }).select('method amount').lean(),
    CustomerPayment.find({ createdAt: { $gte: start, $lt: end } }).select('method amount').lean(),
    Product.find({}).select('name size sku category stock costPrice active').lean(),
    User.find({}).select('name').lean(),
  ]);
  const sales = allSales.filter((s) => s.createdAt >= start);
  const prevSales = allSales.filter((s) => s.createdAt < start);
  res.json({ ...buildOverview({ sales, prevSales, refunds, custPayments, products, users, from, to }), previousRange: prev });
}));

// Daily sales report: one day in full, compared with the day before. ?format=csv&part=sales|items downloads it.
router.get('/daily-sales', asyncHandler(async (req, res) => {
  const { start, end, from } = dayRange(req.query.date, req.query.date);
  const prevStart = new Date(start.getTime() - 86_400_000);
  const [allSales, refunds, custPayments, products, users] = await Promise.all([
    Sale.find({ createdAt: { $gte: prevStart, $lt: end } }).select(`${SALE_FIELDS} receiptNo customerName customerPhone items.packLabel`).lean(),
    Refund.find({ createdAt: { $gte: start, $lt: end } }).select('createdAt receiptNo method amount reason user').lean(),
    CustomerPayment.find({ createdAt: { $gte: start, $lt: end } }).select('createdAt customer method amount note user').lean(),
    Product.find({}).select('name size sku category stock costPrice active unitsPerPack').lean(),
    User.find({}).select('name').lean(),
  ]);
  const customerIds = [...new Set(custPayments.map((p) => String(p.customer)))];
  const customers = customerIds.length ? await Customer.find({ _id: { $in: customerIds } }).select('name').lean() : [];
  const report = buildDailyReport({
    date: from, sales: allSales.filter((s) => s.createdAt >= start), prevSales: allSales.filter((s) => s.createdAt < start),
    refunds, custPayments, products, users, customers,
  });
  if (req.query.format === 'csv') {
    const part = req.query.part === 'items' ? 'items' : 'sales';
    const { header, rows } = dailyCsv(report, part);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${part}-${from}.csv"`);
    return res.send(toCsv(header, rows));
  }
  res.json(report);
}));

export default router;
