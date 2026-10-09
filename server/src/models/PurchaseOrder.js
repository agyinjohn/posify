import mongoose from 'mongoose';

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,   // snapshot
    sku: String,    // snapshot
    qty: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    receivedQty: { type: Number, default: 0 }, // filled in on receive
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: String, // snapshot
    // draft → ordered → received (partial receive keeps it 'ordered')
    status: { type: String, enum: ['draft', 'ordered', 'received'], default: 'draft' },
    lines: [lineSchema],
    total: { type: Number, default: 0 },
    note: { type: String, trim: true, maxlength: 200, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ status: 1, createdAt: -1 });
schema.index({ supplier: 1, createdAt: -1 });

export default mongoose.model('PurchaseOrder', schema);
