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
import { applyReceipt } from '../lib/cost.js';
import { productLabel } from '../lib/productLabel.js';

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
    return { product: p._id, name: productLabel(p), sku: p.sku, qty, unitCost, lineTotal: r2(qty * unitCost) };
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
// Lines default to what is still outstanding; send lines:[{productId, qty, unitCost}] for what actually arrived.
// The PO stays 'ordered' until every line is fully received, so a short delivery can be completed later.
router.post('/:id/receive', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const po = await PurchaseOrder.findOne({ _id: req.params.id, status: { $in: ['draft', 'ordered'] } });
  if (!po) throw new SaleError('PO not found or already received', 404);

  const overrideMap = new Map((Array.isArray(req.body.lines) ? req.body.lines : []).map((o) => [String(o?.productId), o]));

  // Validate everything before writing anything.
  const plan = [];
  for (const [index, line] of po.lines.entries()) {
    const ov = overrideMap.get(String(line.product));
    const outstanding = r3(Math.max(line.qty - (line.receivedQty || 0), 0));
    const qty = ov ? r3(num(ov.qty, 'Quantity', { min: 0, max: 1e6 })) : outstanding;
    if (qty <= 0) continue;
    const unitCost = ov?.unitCost !== undefined ? r2(num(ov.unitCost, 'Unit cost', { min: 0 })) : line.unitCost;
    if (!(await Product.exists({ _id: line.product }))) throw new SaleError(`${line.name} no longer exists, so it can't be received`, 409);
    plan.push({ index, line, qty, unitCost, receivedQty: r3((line.receivedQty || 0) + qty) });
  }
  if (plan.length === 0) throw new SaleError('No lines to receive');
  const complete = po.lines.every((l, i) => r3(plan.find((p) => p.index === i)?.receivedQty ?? (l.receivedQty || 0)) >= l.qty);

  // Claim the PO first (optimistic lock) so two clicks or two tills cannot receive the same stock twice.
  const set = { status: complete ? 'received' : 'ordered' };
  const oldSet = { status: po.status };
  for (const p of plan) { set[`lines.${p.index}.receivedQty`] = p.receivedQty; oldSet[`lines.${p.index}.receivedQty`] = p.line.receivedQty || 0; }
  if (complete) { set.receivedBy = req.user._id; set.receivedAt = new Date(); }
  const rev = po.rev || 0;
  const claimed = await PurchaseOrder.findOneAndUpdate(
    { _id: po._id, status: { $in: ['draft', 'ordered'] }, ...(rev ? { rev } : { $or: [{ rev: 0 }, { rev: { $exists: false } }] }) },
    { $set: set, $inc: { rev: 1 } },
    { new: true },
  );
  if (!claimed) throw new SaleError('This PO was just changed by someone else. Reload and try again', 409);

  const done = [];
  try {
    for (const p of plan) {
      const result = await applyReceipt({
        qty: p.qty,
        unitCost: p.unitCost,
        read: async () => Product.findById(p.line.product).select('stock costPrice').lean(),
        cas: (prev, next) => Product.findOneAndUpdate({ _id: p.line.product, stock: prev.stock, costPrice: prev.costPrice }, { $set: next }, { new: true }),
      });
      if (!result) throw new SaleError(`Stock for ${p.line.name} kept changing. Please try again`, 409);
      done.push({ p, result });
    }
    await StockMovement.insertMany(done.map(({ p }) => ({
      product: p.line.product, type: 'receipt', qty: p.qty, costPrice: p.unitCost,
      reason: `PO from ${po.supplierName}`, user: req.user._id,
    })));
  } catch (err) {
    // Put back what was received and reopen the PO.
    for (const { p, result } of done) {
      const back = await Product.findOneAndUpdate({ _id: p.line.product, stock: result.next.stock, costPrice: result.next.costPrice }, { $set: result.prev }).catch(() => null);
      if (!back) await Product.updateOne({ _id: p.line.product }, { $inc: { stock: -p.qty } }).catch(() => {});
    }
    await PurchaseOrder.updateOne(
      { _id: po._id },
      { $set: oldSet, ...(complete ? { $unset: { receivedBy: '', receivedAt: '' } } : {}) },
    ).catch(() => {});
    throw err;
  }

  audit({ req, action: 'po.receive', target: po.supplierName, targetId: po._id, detail: { lines: plan.length, complete } });
  res.json(claimed);
}));

export default router;
