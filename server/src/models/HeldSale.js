import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 80, default: '' },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mode: { type: String, enum: ['retail', 'wholesale'], default: 'retail' },
    orderDiscount: { type: Number, default: 0 },
    // Minimal cart snapshot: just enough to restore the Sell page state.
    items: [{ _id: false, productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, qty: Number, discount: { type: Number, default: 0 } }],
  },
  { timestamps: true },
);

export default mongoose.model('HeldSale', schema);
