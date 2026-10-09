import Customer from '../models/Customer.js';
import { r2 } from './money.js';

// Adjust what a customer owes. Rounds afterwards so float drift (0.1 + 0.2) never builds up.
export async function adjustBalance(customerId, delta, { requireCovered = false } = {}) {
  const filter = { _id: customerId };
  if (requireCovered) filter.balance = { $gte: r2(-delta) - 0.005 };
  const c = await Customer.findOneAndUpdate(filter, { $inc: { balance: delta } }, { new: true });
  if (!c) return null;
  const clean = r2(c.balance);
  if (clean !== c.balance) {
    await Customer.updateOne({ _id: c._id }, { $set: { balance: clean } });
    c.balance = clean;
  }
  return c;
}
