import mongoose from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';

const schema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 80, default: '' },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mode: { type: String, enum: ['retail', 'wholesale'], default: 'retail' },
    orderDiscount: { type: Number, default: 0 },
    // Minimal cart snapshot: just enough to restore the Sell page state.
    items: [{ _id: false, productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, qty: Number, unit: { type: String, enum: ['piece', 'pack'], default: 'piece' }, discount: { type: Number, default: 0 } }],
  },
  { timestamps: true },
);

schema.plugin(tenantPlugin); // every record belongs to one shop (lib/tenant.js)

export default mongoose.model('HeldSale', schema);
