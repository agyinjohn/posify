import mongoose from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';
import { PAYMENT_METHODS } from '../lib/money.js';

// Money the shop spends that is not stock: rent, salaries, transport, light bill... Net profit = gross profit − expenses.
// fromTill: paid in cash out of the drawer, so the shift cash-up expects that much less cash.
const schema = new mongoose.Schema(
  {
    date: { type: Date, required: true },       // when it was paid (can be back-dated)
    category: { type: String, required: true, trim: true, maxlength: 40 },
    amount: { type: Number, required: true, min: 0.01, max: 1e9 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    fromTill: { type: Boolean, default: false },
    paidTo: { type: String, trim: true, maxlength: 80, default: '' },
    note: { type: String, trim: true, maxlength: 200, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

schema.index({ shop: 1, date: -1 });
schema.index({ shop: 1, createdAt: -1 });

schema.plugin(tenantPlugin); // every record belongs to one shop (lib/tenant.js)

export default mongoose.model('Expense', schema);
