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

const router = Router();
router.use(requireAuth, requireOwner);

// Receive stock. Cost price becomes the weighted average of old stock and the new delivery.
// (Read-then-write: fine for one shop; two owners receiving the same product at the same instant could race.)
router.post('/receive', asyncHandler(async (req, res) => {
  const { productId, note } = req.body;
  assertId(productId, 'product');
  const qty = r3(num(req.body.qty, 'Quantity', { min: 0, max: 1e6, allowZero: false }));
  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const unitCost = req.body.costPrice === undefined || req.body.costPrice === '' ? product.costPrice : num(req.body.costPrice, 'Cost price');
  const newCost = product.stock > 0 ? r2((product.stock * product.costPrice + qty * unitCost) / (product.stock + qty)) : r2(unitCost);

  const updated = await Product.findByIdAndUpdate(productId, { $inc: { stock: qty }, $set: { costPrice: newCost } }, { new: true });
  await StockMovement.create({ product: productId, type: 'receipt', qty, costPrice: unitCost, reason: typeof note === 'string' ? note.slice(0, 200) : undefined, user: req.user._id });
  res.status(201).json(updated);
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
  if (typeof req.query.type === 'string' && ['opening', 'receipt', 'sale', 'void', 'adjustment'].includes(req.query.type)) filter.type = req.query.type;
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

  const products = await Product.find({ active: true }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const resultLines = [];
  const adjustments = [];

  for (const l of lines) {
    assertId(l?.productId, 'product');
    const counted = r3(num(l.countedQty, 'Counted quantity', { min: 0, max: 1e6 }));
    const p = byId.get(String(l.productId));
    if (!p) throw new SaleError(`Product not found: ${l.productId}`, 404);
    const variance = r3(counted - p.stock);
    resultLines.push({ product: p._id, name: p.name, sku: p.sku, systemQty: p.stock, countedQty: counted, variance });
    if (variance !== 0) adjustments.push({ p, variance, counted });
  }

  // Apply all stock adjustments.
  await Promise.all(adjustments.map(({ p, variance, counted }) =>
    Product.updateOne({ _id: p._id }, { $set: { stock: counted } }),
  ));

  // Write one adjustment movement per variance line.
  if (adjustments.length > 0) {
    await StockMovement.insertMany(adjustments.map(({ p, variance }) => ({
      product: p._id,
      type: 'adjustment',
      qty: variance,
      reason: `Stock take${note ? ': ' + note.slice(0, 160) : ''}`,
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

  audit({ req, action: 'stocktake', detail: { linesCount: resultLines.length, varianceCount } });
  res.status(201).json(stockTake);
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
