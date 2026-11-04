import mongoose from 'mongoose';
import { currentShop, tenantPlugin } from '../lib/tenant.js';

// Receipt numbers count per shop: each shop's counter document is keyed "<shopId>:receipt".
const schema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
schema.plugin(tenantPlugin);
const Counter = mongoose.model('Counter', schema);

export const receiptCounterId = (shop) => `${shop}:receipt`;

export async function nextReceiptNo() {
  const shop = currentShop();
  const c = await Counter.findOneAndUpdate(
    { _id: receiptCounterId(shop) },
    { $inc: { seq: 1 }, $setOnInsert: { shop: new mongoose.Types.ObjectId(shop) } },
    { new: true, upsert: true },
  );
  return `R-${String(c.seq).padStart(6, '0')}`;
}

export default Counter;
