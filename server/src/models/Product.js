import mongoose from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Optional size label ("Small", "500ml", "XL"): shown after the name, e.g. "Super Star (Small)". Each size is
    // its own product with its own price and stock; leave empty for products without sizes.
    size: { type: String, trim: true, maxlength: 30, default: '' },
    sku: { type: String, required: true, trim: true, maxlength: 60 }, // unique within a shop (index below)
    // An empty barcode means "no barcode": never store '' (the per-shop unique rule counts every text value, so
    // two products with a blank barcode would clash).
    barcode: { type: String, trim: true, maxlength: 60, set: (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v) },
    category: { type: String, trim: true, maxlength: 60, default: 'General' },
    costPrice: { type: Number, required: true, min: 0, default: 0 },
    retailPrice: { type: Number, required: true, min: 0 },
    // 0 means "no wholesale price set": wholesale sales fall back to retail
    wholesalePrice: { type: Number, min: 0, default: 0 },
    // Optional price for a whole pack (carton/box) when it is not simply pieces x the piece price. 0 = not set.
    packRetailPrice: { type: Number, min: 0, default: 0 },
    packWholesalePrice: { type: Number, min: 0, default: 0 },
    stock: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },
    // Unit conversion: 1 means no pack (sold by piece only).
    // e.g. unitsPerPack=12, packLabel='ctn' means 1 carton = 12 pieces.
    unitsPerPack: { type: Number, default: 1, min: 1 },
    packLabel: { type: String, trim: true, maxlength: 20, default: '' },
    image: { url: String, publicId: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

productSchema.index({ shop: 1, sku: 1 }, { unique: true });
productSchema.index({ shop: 1, active: 1, name: 1 }); // product list sorted by name
productSchema.index({ shop: 1, barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } });

productSchema.plugin(tenantPlugin); // every record belongs to one shop (lib/tenant.js)

export default mongoose.model('Product', productSchema);
