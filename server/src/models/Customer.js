import mongoose from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 30 },
    creditLimit: { type: Number, min: 0, default: 0 }, // 0 = no limit set
    balance: { type: Number, default: 0 }, // amount the customer owes
  },
  { timestamps: true },
);

schema.index({ shop: 1, name: 1 });

schema.plugin(tenantPlugin); // every record belongs to one shop (lib/tenant.js)

export default mongoose.model('Customer', schema);
