import { Router } from 'express';
import multer from 'multer';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, escapeRegex, pick } from '../lib/validate.js';
import { config } from '../config.js';
import { uploadImage, deleteImage } from '../lib/cloud.js';
import { SaleError } from '../lib/pricing.js';
import { audit } from '../lib/audit.js';
import { productLabel } from '../lib/productLabel.js';
import mongoose from 'mongoose';
import { planVariants, comboKey } from '../lib/variants.js';
import { buildImportPlan, summarize, applyPlan } from '../lib/productImport.js';
import { fillBarcodes, newBarcode } from '../lib/barcodes.js';

const router = Router();
const FIELDS = ['name', 'size', 'color', 'sku', 'barcode', 'category', 'costPrice', 'retailPrice', 'wholesalePrice', 'packRetailPrice', 'packWholesalePrice', 'reorderLevel', 'unitsPerPack', 'packLabel'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new SaleError('Image must be JPG, PNG or WebP')),
});

// A product with no pack size cannot have pack prices.
const dropPackPricesIfNoPack = (data) => {
  if (data.unitsPerPack !== undefined && !(Number(data.unitsPerPack) > 1)) { data.packRetailPrice = 0; data.packWholesalePrice = 0; }
};

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { q, category, lowStock, all } = req.query;
  const filter = {};
  if (!(all === '1' && req.user.role === 'owner')) filter.active = true;
  if (typeof category === 'string' && category) filter.category = category;
  if (typeof q === 'string' && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim().slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { size: rx }, { color: rx }, { sku: rx }, { barcode: rx }];
  }
  if (lowStock === '1') filter.$expr = { $lte: ['$stock', '$reorderLevel'] };
  const query = Product.find(filter).sort({ name: 1 }).limit(5000).lean(); // plain objects: much cheaper to build and send
  if (req.user.role !== 'owner') query.select('-costPrice'); // cashiers never see cost
  res.json(await query);
}));

// Bulk import from a spreadsheet saved as CSV. The browser sends the header row and the cell rows as arrays
// (so spreadsheet titles never become object keys). dryRun checks everything and reports; without it the rows are written.
const MAX_IMPORT_ROWS = 2000;
router.post('/import', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const { headers, rows, mode = 'skip', dryRun = true } = req.body || {};
  if (!Array.isArray(headers) || headers.length === 0 || headers.length > 80 || !headers.every((h) => typeof h === 'string' && h.length < 120)) throw new SaleError('The first row must be the column titles');
  if (!Array.isArray(rows) || rows.length === 0) throw new SaleError('No product rows found');
  if (rows.length > MAX_IMPORT_ROWS) throw new SaleError(`Too many rows (${rows.length}). Import up to ${MAX_IMPORT_ROWS} at a time`);
  if (!['skip', 'update'].includes(mode)) throw new SaleError('Invalid import mode');
  if (!rows.every((r) => Array.isArray(r) && r.length <= 80 && r.every((c) => c === null || ['string', 'number'].includes(typeof c) && String(c).length < 300))) throw new SaleError('The file has an unreadable row');

  const { plan, recognized, ignored } = await buildImportPlan({ Product, headers, rows, mode });
  const summary = summarize(plan);
  const view = plan.map((e) => ({ row: e.row, status: e.status, name: e.name, sku: e.sku, errors: e.errors, warnings: e.warnings,
    barcode: e.data.barcode, prices: { cost: e.data.costPrice, retail: e.data.retailPrice, packRetail: e.data.packRetailPrice, units: e.data.unitsPerPack, stock: e.data.stock } }));
  if (dryRun) return res.json({ dryRun: true, mode, columns: { recognized, ignored }, summary, rows: view });

  const results = await applyPlan({ plan, Product, StockMovement, userId: req.user._id, newId: () => new mongoose.Types.ObjectId() });
  const done = view.map((v) => {
    const r = results.get(v.row);
    return r && !r.ok ? { ...v, status: 'error', errors: [...v.errors, r.message] } : v;
  });
  const failedLate = done.filter((v) => v.status === 'error').length - summary.error;
  const result = {
    created: done.filter((v) => v.status === 'create').length,
    updated: done.filter((v) => v.status === 'update').length,
    skipped: summary.skip,
    failed: summary.error + failedLate,
  };
  audit({ req, action: 'product.import', detail: { ...result, mode } });
  res.json({ dryRun: false, mode, summary: result, rows: done });
}));

// A shop barcode no product in this shop uses yet.
async function freeBarcode() {
  for (let i = 0; i < 5; i += 1) {
    const code = newBarcode();
    if (!(await Product.exists({ barcode: code }))) return code;
  }
  throw new SaleError('Could not make a barcode. Try again', 409);
}

// Give every product that has no barcode (added before barcodes were automatic) a shop barcode.
router.post('/fill-barcodes', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const all = await Product.find({}).select('barcode').lean();
  const missing = all.filter((p) => !p.barcode);
  fillBarcodes(missing, new Set(all.map((p) => p.barcode).filter(Boolean)));
  if (missing.length) {
    await Product.bulkWrite(missing.map((p) => ({ updateOne: { filter: { _id: p._id, barcode: { $exists: false } }, update: { $set: { barcode: p.barcode } } } })), { ordered: false });
    audit({ req, action: 'product.edit', target: `Barcodes made for ${missing.length} products`, detail: { count: missing.length } });
  }
  res.json({ filled: missing.length });
}));

router.post('/', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const data = pick(req.body, FIELDS);
  dropPackPricesIfNoPack(data);
  if (!data.barcode) data.barcode = await freeBarcode();
  const opening = Number(req.body.stock) || 0;
  if (opening < 0) throw new SaleError('Opening stock cannot be negative');
  const product = await Product.create({ ...data, stock: opening });
  if (opening > 0) {
    await StockMovement.create({ product: product._id, type: 'opening', qty: opening, costPrice: product.costPrice, user: req.user._id });
  }
  audit({ req, action: 'product.create', target: productLabel(product), targetId: product._id });
  res.status(201).json(product);
}));

// Several sizes / colours of one product in one go: each combination becomes its own product sharing the name,
// category, prices and pack details. Used to add a new product with its sizes and colours, or more of them later.
const SHARED = ['name', 'sku', 'category', 'costPrice', 'retailPrice', 'packRetailPrice', 'reorderLevel', 'unitsPerPack', 'packLabel'];
router.post('/variants', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const base = pick(req.body?.base || {}, SHARED);
  dropPackPricesIfNoPack(base);
  base.wholesalePrice = 0; base.packWholesalePrice = 0;
  const all = await Product.find({}).select('name size color sku barcode').lean();
  const docs = planVariants({
    base, combos: req.body?.combos,
    takenSkus: new Set(all.map((p) => p.sku)),
    takenBarcodes: new Set(all.map((p) => p.barcode).filter(Boolean)),
    existing: new Set(all.map((p) => comboKey(p.name, p.size, p.color))),
  });
  const created = [];
  try {
    for (const d of docs) {
      // One by one with the full model checks; on any failure the ones already made are removed again.
      created.push(await Product.create(d));
    }
  } catch (err) {
    await Product.deleteMany({ _id: { $in: created.map((p) => p._id) } }).catch(() => {});
    if (err?.code === 11000) throw new SaleError('A SKU or barcode is already in use. Try again', 409);
    throw err;
  }
  const opening = created.filter((p) => p.stock > 0);
  if (opening.length) {
    await StockMovement.insertMany(opening.map((p) => ({ product: p._id, type: 'opening', qty: p.stock, costPrice: p.costPrice, user: req.user._id })));
  }
  audit({ req, action: 'product.create', target: `${base.name} (${created.length} sizes/colours)`, detail: { skus: created.map((p) => p.sku) } });
  res.status(201).json(created);
}));

router.patch('/:id', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const set = pick(req.body, [...FIELDS, 'active']); // stock is deliberately not editable here
  dropPackPricesIfNoPack(set);
  // A cleared barcode is replaced with a new shop barcode: every product keeps one to scan and print.
  if (set.barcode === '' || set.barcode === null) set.barcode = await freeBarcode();
  const update = { $set: set };
  const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  // Log price changes explicitly so they are easy to filter in the audit log.
  const priceKeys = ['costPrice', 'retailPrice', 'wholesalePrice', 'packRetailPrice', 'packWholesalePrice'];
  const priceChanged = priceKeys.some((k) => set[k] !== undefined);
  audit({ req, action: priceChanged ? 'product.price' : 'product.edit', target: product.name, targetId: product._id, detail: set });
  res.json(product);
}));

// Soft delete: sales history keeps pointing at the product.
router.delete('/:id', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  audit({ req, action: 'product.delete', target: product.name, targetId: product._id });
  res.json(product);
}));

router.post('/:id/image', requireAuth, requireOwner, upload.single('image'), asyncHandler(async (req, res) => {
  assertId(req.params.id);
  if (!config.cloudinaryEnabled) return res.status(501).json({ error: 'Image upload is not set up. Add Cloudinary keys to the server .env' });
  if (!req.file) throw new SaleError('Choose an image to upload');
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const result = await uploadImage(req.file.buffer);
  const oldId = product.image?.publicId;
  product.image = { url: result.secure_url, publicId: result.public_id };
  await product.save();
  if (oldId) deleteImage(oldId).catch((e) => console.error('Cloudinary delete failed', e.message));
  res.json(product);
}));

export default router;
