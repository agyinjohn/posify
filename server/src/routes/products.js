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

const router = Router();
const FIELDS = ['name', 'sku', 'barcode', 'category', 'costPrice', 'retailPrice', 'wholesalePrice', 'reorderLevel', 'unitsPerPack', 'packLabel'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new SaleError('Image must be JPG, PNG or WebP')),
});

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { q, category, lowStock, all } = req.query;
  const filter = {};
  if (!(all === '1' && req.user.role === 'owner')) filter.active = true;
  if (typeof category === 'string' && category) filter.category = category;
  if (typeof q === 'string' && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim().slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }
  if (lowStock === '1') filter.$expr = { $lte: ['$stock', '$reorderLevel'] };
  const query = Product.find(filter).sort({ name: 1 }).limit(1000);
  if (req.user.role !== 'owner') query.select('-costPrice'); // cashiers never see cost
  res.json(await query);
}));

router.post('/', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const data = pick(req.body, FIELDS);
  if (!data.barcode) delete data.barcode;
  const opening = Number(req.body.stock) || 0;
  if (opening < 0) throw new SaleError('Opening stock cannot be negative');
  const product = await Product.create({ ...data, stock: opening });
  if (opening > 0) {
    await StockMovement.create({ product: product._id, type: 'opening', qty: opening, costPrice: product.costPrice, user: req.user._id });
  }
  audit({ req, action: 'product.create', target: product.name, targetId: product._id });
  res.status(201).json(product);
}));

router.patch('/:id', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const set = pick(req.body, [...FIELDS, 'active']); // stock is deliberately not editable here
  const update = { $set: set };
  if (set.barcode === '' || set.barcode === null) {
    delete set.barcode;
    update.$unset = { barcode: '' };
  }
  const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  // Log price changes explicitly so they are easy to filter in the audit log.
  const priceKeys = ['costPrice', 'retailPrice', 'wholesalePrice'];
  const priceChanged = priceKeys.some((k) => set[k] !== undefined);
  audit({ req, action: priceChanged ? 'product.price' : 'product.edit', target: product.name, targetId: product._id, detail: set });
  res.json(product);
}));

// Soft delete: sales history keeps pointing at the product.
router.delete('/:id', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) return res.status(404).json({ error: 'Product not found' });
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
