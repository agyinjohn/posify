import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    email: { type: String, trim: true, maxlength: 120, default: '' },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

schema.index({ name: 1 });

export default mongoose.model('Supplier', schema);
