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
    // Stored at close so history shows the real variance, not just closing cash minus float.
    expectedCash: { type: Number, default: null },
    cashVariance: { type: Number, default: null },
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

schema.index({ status: 1, createdAt: -1 });
// At most one open shift, even if two tills press Open at the same moment.
schema.index({ status: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });

export default mongoose.model('Shift', schema);
