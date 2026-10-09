import mongoose from 'mongoose';

// Every stock change is a row here. product.stock is the running total.
const schema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    type: { type: String, enum: ['opening', 'receipt', 'sale', 'void', 'adjustment'], required: true },
    qty: { type: Number, required: true }, // signed: negative removes stock
    costPrice: Number,
    reason: { type: String, trim: true, maxlength: 200 },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.model('StockMovement', schema);
