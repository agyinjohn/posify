import { Router } from 'express';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import StockTake from '../models/StockTake.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, num } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { r2, r3 } from '../lib/money.js';
import { audit } from '../lib/audit.js';
import { applyCount } from '../lib/stocktake.js';
import { applyReceipt } from '../lib/cost.js';

const router = Router();
router.use(requireAuth, requireOwner);

// Receive stock. Cost price becomes the weighted average of old stock and the new delivery.
// Compare-and-set on (stock, cost): a sale or another delivery landing mid-update triggers a recompute
// instead of corrupting the average.
router.post('/receive', asyncHandler(async (req, res) => {
  const { productId, note } = req.body;
  assertId(productId, 'product');
  const qty = r3(num(req.body.qty, 'Quantity', { min: 0, max: 1e6, allowZero: false }));
  const unitCost = req.body.costPrice === undefined || req.body.costPrice === '' ? undefined : num(req.body.costPrice, 'Cost price');

  const result = await applyReceipt({
    qty,
    unitCost,
    read: async () => Product.findById(productId).select('stock costPrice').lean(),
    cas: (prev, next) => Product.findOneAndUpdate(
      { _id: productId, stock: prev.stock, costPrice: prev.costPrice },
      { $set: next },
      { new: true },
    ),
  });
  if (!result) {
    const exists = await Product.exists({ _id: productId });
    if (!exists) return res.status(404).json({ error: 'Product not found' });
    throw new SaleError('Stock kept changing while receiving. Please try again', 409);
  }
  await StockMovement.create({ product: productId, type: 'receipt', qty, costPrice: result.unitCost, reason: typeof note === 'string' ? note.slice(0, 200) : undefined, user: req.user._id });
  res.status(201).json(result.doc);
}));

// Adjust stock up or down (damage, theft, count correction). A reason is mandatory.
router.post('/adjust', asyncHandler(async (req, res) => {
  const { productId, reason } = req.body;
  assertId(productId, 'product');
  const qty = r3(num(req.body.qty, 'Quantity', { min: -1e6, max: 1e6, allowZero: false }));
  if (typeof reason !== 'string' || reason.trim().length < 3) throw new SaleError('Give a reason for the adjustment');

  const filter = qty < 0 ? { _id: productId, stock: { $gte: -qty } } : { _id: productId };
  const updated = await Product.findOneAndUpdate(filter, { $inc: { stock: qty } }, { new: true });
  if (!updated) throw new SaleError('Product not found, or not enough stock to remove that amount', 409);
  await StockMovement.create({ product: productId, type: 'adjustment', qty, reason: reason.trim().slice(0, 200), user: req.user._id });
  res.status(201).json(updated);
}));

router.get('/movements', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.productId) { assertId(req.query.productId, 'product'); filter.product = req.query.productId; }
  if (typeof req.query.type === 'string' && ['opening', 'receipt', 'sale', 'void', 'return', 'adjustment'].includes(req.query.type)) filter.type = req.query.type;
  const rows = await StockMovement.find(filter).sort({ createdAt: -1 }).limit(200)
    .populate('product', 'name sku').populate('user', 'name');
  res.json(rows);
}));

// Stock take: owner submits a full physical count.
// For every product where countedQty differs from systemQty an adjustment movement is written
// and the product stock is updated atomically.
router.post('/stocktake', asyncHandler(async (req, res) => {
  const { note, lines } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) throw new SaleError('No lines provided');

  const products = await Product.find({ active: true }).select('name sku').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const seen = new Set();
  const counts = [];
  for (const l of lines) {
    assertId(l?.productId, 'product');
    const id = String(l.productId);
    if (seen.has(id)) throw new SaleError('The same product appears twice in this count');
    seen.add(id);
    if (!byId.has(id)) throw new SaleError(`Product not found: ${l.productId}`, 404);
    counts.push({ p: byId.get(id), counted: r3(num(l.countedQty, 'Counted quantity', { min: 0, max: 1e6 })) });
  }

  // Each product is set with compare-and-set, so a sale made while this count is being saved
  // is never wiped: the variance is recomputed against the stock that was really replaced.
  const resultLines = [];
  const adjustments = [];
  const skipped = [];
  for (const { p, counted } of counts) {
    const applied = await applyCount({
      counted,
      read: async () => (await Product.findById(p._id).select('stock').lean())?.stock ?? null,
      cas: async (expected, value) => !!(await Product.findOneAndUpdate({ _id: p._id, stock: expected }, { $set: { stock: value } })),
    });
    if (!applied) { skipped.push(p.name); continue; }
    resultLines.push({ product: p._id, name: p.name, sku: p.sku, systemQty: applied.systemQty, countedQty: counted, variance: applied.variance });
    if (applied.variance !== 0) adjustments.push({ p, variance: applied.variance });
  }

  // Write one adjustment movement per variance line.
  if (adjustments.length > 0) {
    await StockMovement.insertMany(adjustments.map(({ p, variance }) => ({
      product: p._id,
      type: 'adjustment',
      qty: variance,
      reason: `Stock take${note ? ': ' + String(note).slice(0, 160) : ''}`,
      user: req.user._id,
    })));
  }

  const varianceCount = resultLines.filter((l) => l.variance !== 0).length;
  const stockTake = await StockTake.create({
    note: typeof note === 'string' ? note.slice(0, 200) : '',
    createdBy: req.user._id,
    createdByName: req.user.name,
    linesCount: resultLines.length,
    varianceCount,
    lines: resultLines,
  });

  audit({ req, action: 'stocktake', detail: { linesCount: resultLines.length, varianceCount, skipped } });
  res.status(201).json({ ...stockTake.toObject(), skipped });
}));

// Stock take history (summary only, no lines).
router.get('/stocktakes', asyncHandler(async (_req, res) => {
  const rows = await StockTake.find().sort({ createdAt: -1 }).limit(50)
    .select('-lines').populate('createdBy', 'name');
  res.json(rows);
}));

// Single stock take with full lines.
router.get('/stocktakes/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const st = await StockTake.findById(req.params.id).populate('createdBy', 'name');
  if (!st) return res.status(404).json({ error: 'Stock take not found' });
  res.json(st);
}));

export default router;
