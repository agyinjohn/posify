import { PAYMENT_METHODS, r2 } from './money.js';
import { netSale } from './returns.js';

/**
 * Cash-up summary for a period (a shift). Pure, so it can be tested.
 * sales: every sale made in the period (any status); custPayments: debt payments; refunds: money paid back.
 * Voided/partly returned sales still count their original payments; the Refund rows take the money back out,
 * so each payment method matches what is really in the till. Voids from before refunds were tracked
 * (no refundedTotal) are skipped, as they always were.
 */
export function cashUp({ sales, custPayments = [], refunds = [], openingFloat = 0, closingCash = null }) {
  const counted = sales.filter((s) => s.status !== 'voided' || s.refundedTotal != null);
  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));
  let total = 0, discounts = 0, creditGiven = 0, debtCollected = 0, refunded = 0;

  for (const s of counted) {
    const n = netSale(s);
    total += n.net;
    discounts += s.discountTotal || 0;
    creditGiven += n.credit;
    for (const p of s.payments || []) byMethod[p.method] = r2(byMethod[p.method] + p.amount);
  }
  for (const p of custPayments) { byMethod[p.method] = r2(byMethod[p.method] + p.amount); debtCollected += p.amount; }
  for (const rf of refunds) { byMethod[rf.method] = r2(byMethod[rf.method] - rf.amount); refunded += rf.amount; }

  const expectedCash = r2(openingFloat + byMethod.Cash);
  return {
    salesCount: counted.filter((s) => s.status !== 'voided').length,
    total: r2(total),
    discounts: r2(discounts),
    creditGiven: r2(creditGiven),
    debtCollected: r2(debtCollected),
    refunded: r2(refunded),
    byMethod,
    expectedCash,
    cashVariance: closingCash === null ? null : r2(closingCash - expectedCash),
  };
}
