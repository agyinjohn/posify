import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    sku: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    barcode: { type: String, trim: true, maxlength: 60 },
    category: { type: String, trim: true, maxlength: 60, default: 'General' },
    costPrice: { type: Number, required: true, min: 0, default: 0 },
    retailPrice: { type: Number, required: true, min: 0 },
    // 0 means "no wholesale price set": wholesale sales fall back to retail
    wholesalePrice: { type: Number, min: 0, default: 0 },
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

productSchema.index({ barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } });

export default mongoose.model('Product', productSchema);
