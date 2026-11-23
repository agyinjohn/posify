/**
 * Barcodes the shop makes itself, for products that come without one (clothes, home-made goods, anything
 * re-packed). They are EAN-13 numbers starting with 2: the range set aside for a shop's own use, so they never
 * clash with a maker's barcode on packaged goods. Any scanner reads them, as EAN-13 or as the Code 128 we print.
 */

/** The EAN-13 check digit for 12 digits. */
export function ean13CheckDigit(twelve) {
  if (!/^\d{12}$/.test(twelve)) throw new Error('EAN-13 needs 12 digits before the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(twelve[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

export const ean13 = (twelve) => twelve + ean13CheckDigit(twelve);
export const isEan13 = (code) => /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];

/**
 * A new shop barcode not in `taken` (a Set, which the new code is added to so the next call avoids it too).
 * rand: a function like Math.random (passed in so tests are repeatable).
 */
export function newBarcode(taken = new Set(), rand = Math.random) {
  for (let tries = 0; tries < 1000; tries += 1) {
    let body = '2';
    for (let i = 0; i < 11; i += 1) body += Math.floor(rand() * 10);
    const code = ean13(body);
    if (!taken.has(code)) { taken.add(code); return code; }
  }
  throw new Error('Could not make a free barcode');
}

/** Gives every record without a barcode a new one (in place). Returns how many were filled. */
export function fillBarcodes(records, taken = new Set(), rand = Math.random) {
  records.forEach((r) => { if (r.barcode) taken.add(r.barcode); });
  let filled = 0;
  for (const r of records) {
    if (!r.barcode) { r.barcode = newBarcode(taken, rand); filled += 1; }
  }
  return filled;
}
