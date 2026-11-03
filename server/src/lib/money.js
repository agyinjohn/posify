export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Per-piece costs keep 4 decimals so averaging cartons of odd sizes doesn't lose cents over many deliveries.
export const r4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
export const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
export const PAYMENT_METHODS = ['Cash', 'MoMo', 'Card', 'Transfer'];
