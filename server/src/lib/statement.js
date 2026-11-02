import { r2 } from './money.js';

/**
 * Customer statement rows: credit sales (debit), credit cancelled by returns/voids (credit) and
 * payments (credit), oldest first, with a running balance. The opening balance is worked back from
 * `currentBalance` using the period's movement and `afterNet` (movement after the period ended).
 *
 * Sales from before returns tracked their credit (no creditReturned field) and are left out when voided
 * or partly returned, because their balance changes were never recorded as rows.
 */
const usableSales = (sales) => sales.filter((s) => s.balance > 0 && (s.status === 'completed' || s.creditReturned != null));

// Net change to what the customer owes from a set of records (used for activity after the period).
export const netMovement = ({ sales = [], notes = [], payments = [] }) =>
  r2(usableSales(sales).reduce((t, s) => t + s.balance, 0)
    - notes.reduce((t, n) => t + n.amount, 0)
    - payments.reduce((t, p) => t + p.amount, 0));

export function buildStatement({ sales, notes = [], payments = [], currentBalance, afterNet = 0 }) {
  const rows = [
    ...usableSales(sales).map((s) => ({ date: s.createdAt, type: 'sale', ref: s.receiptNo, debit: s.balance, credit: 0 })),
    ...notes.map((n) => ({ date: n.createdAt, type: 'return', ref: n.receiptNo, debit: 0, credit: n.amount })),
    ...payments.map((p) => ({ date: p.createdAt, type: 'payment', ref: p.method, debit: 0, credit: p.amount })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  const periodNet = r2(rows.reduce((s, r) => s + r.debit - r.credit, 0));
  // Today's balance, minus anything that happened after the period, minus the period itself.
  const openingBalance = r2(currentBalance - afterNet - periodNet);
  let running = openingBalance;
  const statement = rows.map((r) => {
    running = r2(running + r.debit - r.credit);
    return { ...r, balance: running };
  });
  return { openingBalance, closingBalance: running, statement };
}
