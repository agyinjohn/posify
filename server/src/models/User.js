import mongoose from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 40 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['owner', 'cashier'], default: 'cashier' },
    active: { type: Boolean, default: true },
    // Sign-in tokens issued before this moment are rejected (set whenever the password changes).
    passwordChangedAt: { type: Date, default: null },
    // Set when an owner hands out a temporary password: the user must choose their own before doing anything else.
    mustChangePassword: { type: Boolean, default: false },
    // One-time recovery codes (owner only): bcrypt hashes, see lib/recoveryCodes.js.
    recoveryCodes: { type: [{ _id: false, hash: String, usedAt: { type: Date, default: null } }], select: false },
    recoveryCodesCreatedAt: { type: Date, default: null },
    // Remembers which RESET_OWNER_PASSWORD value was already applied (see lib/ownerReset.js).
    ownerResetFingerprint: { type: String, select: false },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.ownerResetFingerprint;
    delete ret.recoveryCodes;
    delete ret.__v;
    return ret;
  },
});

userSchema.plugin(tenantPlugin); // every record belongs to one shop (lib/tenant.js)

export default mongoose.model('User', userSchema);
