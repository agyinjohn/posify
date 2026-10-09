import mongoose from 'mongoose';
import { PAYMENT_METHODS } from '../lib/money.js';

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    sku: String,
    qty: Number,
    unitPrice: Number,
    costPrice: Number, // snapshot, so profit stays correct after cost changes
    discount: Number,
    lineTotal: Number,
    returnedQty: { type: Number, default: 0 }, // cumulative qty returned on this line
    // Pack / unit conversion snapshot
    packQty: { type: Number, default: null },
    packLabel: { type: String, default: null },
    unitsPerPack: { type: Number, default: null },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    receiptNo: { type: String, unique: true, required: true },
    mode: { type: String, enum: ['retail', 'wholesale'], required: true },
    items: [itemSchema],
    grossTotal: Number,
    subtotal: Number,
    orderDiscount: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    total: { type: Number, required: true },
    payments: [{ _id: false, method: { type: String, enum: PAYMENT_METHODS }, amount: Number }],
    amountPaid: Number,
    change: { type: Number, default: 0 },
    balance: { type: Number, default: 0 }, // owed on credit at time of sale
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String,
    note: { type: String, trim: true, maxlength: 200 },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['completed', 'voided', 'partial-return'], default: 'completed' },
    voidReason: String,
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    voidedAt: Date,
  },
  { timestamps: true },
);

schema.index({ createdAt: -1 });
schema.index({ cashier: 1, createdAt: -1 });

export default mongoose.model('Sale', schema);
