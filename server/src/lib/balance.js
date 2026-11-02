import Customer from '../models/Customer.js';
import { r2 } from './money.js';

// Adjust what a customer owes. Rounds afterwards so float drift (0.1 + 0.2) never builds up.
// maxBalance (credit limit, 0 = none) is checked in the same atomic update, so two sales racing
// for the last of a customer's credit cannot both succeed.
export const balanceFilter = (customerId, delta, { requireCovered = false, maxBalance = 0 } = {}) => {
  const filter = { _id: customerId };
  if (requireCovered) filter.balance = { $gte: r2(-delta) - 0.005 };
  if (maxBalance > 0 && delta > 0) filter.balance = { $lte: r2(maxBalance - delta) + 0.005 };
  return filter;
};

export async function adjustBalance(customerId, delta, opts = {}) {
  const filter = balanceFilter(customerId, delta, opts);
  const c = await Customer.findOneAndUpdate(filter, { $inc: { balance: delta } }, { new: true });
  if (!c) return null;
  const clean = r2(c.balance);
  if (clean !== c.balance) {
    await Customer.updateOne({ _id: c._id }, { $set: { balance: clean } });
    c.balance = clean;
  }
  return c;
}
