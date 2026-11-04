export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Per-piece costs keep 4 decimals so averaging cartons of odd sizes doesn't lose cents over many deliveries.
export const r4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
// Per-piece prices keep 6 decimals so a carton of an awkward size still totals exactly.
export const r6 = (n) => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
export const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
export const PAYMENT_METHODS = ['Cash', 'MoMo', 'Card', 'Transfer'];
