import mongoose from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';
import { PAYMENT_METHODS } from '../lib/money.js';

// Money handed back to a customer for returned goods. Shift cash-up and daily reports subtract these
// from the matching payment method so the till still balances after a return or void.
const schema = new mongoose.Schema(
  {
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
    receiptNo: String,
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, maxlength: 200 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ shop: 1, createdAt: -1 });

schema.plugin(tenantPlugin); // every record belongs to one shop (lib/tenant.js)

export default mongoose.model('Refund', schema);
