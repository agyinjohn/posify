import mongoose from 'mongoose';

// A client business on the platform. Not shop-scoped itself: only the platform admin and sign-in read it directly.
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    active: { type: Boolean, default: true }, // false = suspended: nobody in the shop can sign in or use the API
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The owner's temporary password, encrypted (lib/secretBox.js). Shown to the platform admin until the owner
    // chooses their own password, then removed for good.
    tempPassword: { type: String, default: null, select: false },
    tempPasswordSetAt: { type: Date, default: null },
    ownerPasswordChangedAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('Shop', schema);
