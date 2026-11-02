import mongoose from 'mongoose';

// Credit cancelled on a customer's account because goods were returned (or a sale voided).
// Written with the balance change so customer statements can show when it happened.
const schema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
    receiptNo: String,
    amount: { type: Number, required: true, min: 0.01 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.model('CreditNote', schema);
