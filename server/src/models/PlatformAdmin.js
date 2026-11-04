import mongoose from 'mongoose';

// People who run the platform (create and suspend shops). Separate from shop users: an admin cannot sign in to a
// shop, and a shop user can never reach /api/admin.
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 40 },
    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
schema.set('toJSON', { transform: (_d, ret) => { delete ret.passwordHash; delete ret.__v; return ret; } });

export default mongoose.model('PlatformAdmin', schema);
