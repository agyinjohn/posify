import mongoose from 'mongoose';

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    sku: String,
    systemQty: { type: Number, required: true }, // stock at the moment the count was saved
    countedQty: { type: Number, required: true },
    variance: { type: Number, required: true },  // countedQty - systemQty (signed)
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    note: { type: String, trim: true, maxlength: 200, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
    linesCount: { type: Number, default: 0 },
    varianceCount: { type: Number, default: 0 }, // lines where variance !== 0
    lines: [lineSchema],
  },
  { timestamps: true },
);

schema.index({ createdAt: -1 });

export default mongoose.model('StockTake', schema);
