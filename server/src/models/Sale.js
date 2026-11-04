import mongoose from 'mongoose';
import { PAYMENT_METHODS } from '../lib/money.js';

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    sku: String,
    qty: Number,
    unitPrice: Number,
    packPrice: { type: Number, default: null }, // price per pack as charged, when the line includes packs
    costPrice: Number, // snapshot, so profit stays correct after cost changes
    discount: Number,
    lineTotal: Number,
    returnedQty: { type: Number, default: 0 }, // cumulative qty returned on this line
    // Pack / unit conversion snapshot
    packQty: { type: Number, default: null },
    loosePcs: { type: Number, default: null }, // loose pieces sold alongside packs of the same product
    packLabel: { type: String, default: null },
    unitsPerPack: { type: Number, default: null },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    receiptNo: { type: String, unique: true, required: true },
    clientId: { type: String, maxlength: 64 }, // idempotency key from the till, see POST /sales
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
    customerPhone: String, // snapshot, printed on the receipt when provided
    note: { type: String, trim: true, maxlength: 200 },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['completed', 'voided', 'partial-return'], default: 'completed' },
    voidReason: String,
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    voidedAt: Date,
    // Returns bookkeeping. creditReturned = part of the unpaid balance cancelled by returns;
    // refundedTotal = money handed back. rev guards concurrent returns (optimistic lock).
    creditReturned: { type: Number, default: 0 },
    refundedTotal: { type: Number, default: 0 },
    rev: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ createdAt: -1 });
schema.index({ clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
schema.index({ cashier: 1, createdAt: -1 });
schema.index({ customer: 1, createdAt: -1 }); // customer history and statements
schema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Sale', schema);
