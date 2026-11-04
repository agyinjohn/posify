import mongoose from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';

const schema = new mongoose.Schema(
  {
    // Who did it (null for failed logins where we don't know the user yet)
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    username: { type: String, default: null }, // snapshot so it survives user deletion
    action: { type: String, required: true, maxlength: 80 }, // e.g. 'login.success', 'product.edit'
    target: { type: String, default: null, maxlength: 120 }, // human label, e.g. product name
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    detail: { type: mongoose.Schema.Types.Mixed, default: null }, // arbitrary diff / context
    ip: { type: String, default: null, maxlength: 60 },
  },
  { timestamps: true },
);

schema.index({ shop: 1, createdAt: -1 });
schema.index({ shop: 1, user: 1, createdAt: -1 });
schema.index({ shop: 1, action: 1, createdAt: -1 });

schema.plugin(tenantPlugin); // every record belongs to one shop (lib/tenant.js)

export default mongoose.model('AuditLog', schema);
