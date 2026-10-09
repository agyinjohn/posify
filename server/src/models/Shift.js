import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    openedByName: { type: String, required: true },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByName: { type: String, default: null },
    openingFloat: { type: Number, required: true, min: 0, default: 0 },
    closingCash: { type: Number, default: null },   // physical cash counted at close
    note: { type: String, trim: true, maxlength: 200, default: '' },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Shift', schema);
