import mongoose from 'mongoose';

const schema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.model('Counter', schema);

export async function nextReceiptNo() {
  const c = await Counter.findOneAndUpdate({ _id: 'receipt' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `R-${String(c.seq).padStart(6, '0')}`;
}
