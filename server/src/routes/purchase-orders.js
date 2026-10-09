import { Router } from 'express';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, num } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { r2, r3 } from '../lib/money.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, requireOwner);

router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (['draft', 'ordered', 'received'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.supplierId) { assertId(req.query.supplierId, 'supplier'); filter.supplier = req.query.supplierId; }
  const pos = await PurchaseOrder.find(filter).sort({ createdAt: -1 }).limit(200)
    .populate('supplier', 'name').populate('createdBy', 'name');
  res.json(pos);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const po = await PurchaseOrder.findById(req.params.id)
    .populate('supplier', 'name phone').populate('createdBy', 'name').populate('receivedBy', 'name')
    .populate('lines.product', 'name sku stock costPrice');
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  res.json(po);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { supplierId, lines, note } = req.body;
  assertId(supplierId, 'supplier');
  if (!Array.isArray(lines) || lines.length === 0) throw new SaleError('Add at least one line');

  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw new SaleError('Supplier not found', 404);

  const productIds = lines.map((l) => { assertId(l?.productId, 'product'); return l.productId; });
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const poLines = lines.map((l) => {
    const p = byId.get(String(l.productId));
    if (!p) throw new SaleError(`Product not found: ${l.productId}`, 404);
    const qty = r3(num(l.qty, 'Quantity', { min: 0, max: 1e6, allowZero: false }));
    const unitCost = r2(num(l.unitCost ?? p.costPrice, 'Unit cost', { min: 0 }));
    return { product: p._id, name: p.name, sku: p.sku, qty, unitCost, lineTotal: r2(qty * unitCost) };
  });

  const total = r2(poLines.reduce((s, l) => s + l.lineTotal, 0));
  const po = await PurchaseOrder.create({
    supplier: supplier._id,
    supplierName: supplier.name,
    lines: poLines,
    total,
    note: typeof note === 'string' ? note.slice(0, 200) : '',
    createdBy: req.user._id,
  });
  audit({ req, action: 'po.create', target: supplier.name, targetId: po._id, detail: { total, lines: poLines.length } });
  res.status(201).json(po);
}));

// Mark as ordered (sent to supplier).
router.post('/:id/order', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const po = await PurchaseOrder.findOneAndUpdate(
    { _id: req.params.id, status: 'draft' },
    { status: 'ordered' },
    { new: true },
  );
  if (!po) throw new SaleError('PO not found or already ordered', 404);
  audit({ req, action: 'po.order', targetId: po._id });
  res.json(po);
}));

// Receive stock against a PO. Updates product stock + weighted-average cost, writes receipt movements.
router.post('/:id/receive', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const po = await PurchaseOrder.findOne({ _id: req.params.id, status: { $in: ['draft', 'ordered'] } });
  if (!po) throw new SaleError('PO not found or already received', 404);

  // Optional per-line overrides: [{ productId, qty, unitCost }]
  // If not provided, receive the full ordered qty at the ordered cost.
  const overrides = Array.isArray(req.body.lines) ? req.body.lines : [];
  const overrideMap = new Map(overrides.map((o) => [String(o.productId), o]));

  const movements = [];
  for (const line of po.lines) {
    const ov = overrideMap.get(String(line.product));
    const qty = ov ? r3(num(ov.qty, 'Quantity', { min: 0, max: 1e6 })) : line.qty;
    if (qty === 0) continue;
    const unitCost = ov?.unitCost !== undefined ? r2(num(ov.unitCost, 'Unit cost', { min: 0 })) : line.unitCost;

    const product = await Product.findById(line.product);
    if (!product) continue;
    const newCost = product.stock > 0
      ? r2((product.stock * product.costPrice + qty * unitCost) / (product.stock + qty))
      : r2(unitCost);

    await Product.findByIdAndUpdate(line.product, { $inc: { stock: qty }, $set: { costPrice: newCost } });
    line.receivedQty = r3((line.receivedQty || 0) + qty);
    movements.push({ product: line.product, type: 'receipt', qty, costPrice: unitCost,
      reason: `PO from ${po.supplierName}`, user: req.user._id });
  }

  if (movements.length === 0) throw new SaleError('No lines to receive');
  await StockMovement.insertMany(movements);

  po.status = 'received';
  po.receivedBy = req.user._id;
  po.receivedAt = new Date();
  await po.save();

  audit({ req, action: 'po.receive', target: po.supplierName, targetId: po._id, detail: { lines: movements.length } });
  res.json(po);
}));

export default router;
