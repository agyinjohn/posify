import test from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, code128Values, code128Widths, barcodeSvg, BarcodeError } from '../src/barcode.js';

// Read a barcode back from its widths, the way a scanner does, to prove what we print scans as the text.
function decode(widths) {
  const syms = [];
  for (let i = 0; i < widths.length; i += 6) {
    const pat = widths.slice(i, i + (i + 7 === widths.length ? 7 : 6)).join('');
    const v = PATTERNS.indexOf(pat);
    assert.ok(v >= 0, `unknown pattern ${pat}`);
    syms.push(v);
    if (v === 106) break;
  }
  const [start, ...rest] = syms;
  const stop = rest.pop(); const check = rest.pop();
  assert.equal(stop, 106);
  assert.equal(check, [start, ...rest].reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0) % 103, 'check symbol');
  let set = start === 105 ? 'C' : 'B'; let out = '';
  for (const v of rest) {
    if (v === 100) { set = 'B'; continue; }
    if (v === 99) { set = 'C'; continue; }
    out += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return out;
}

test('pattern table: every symbol is 11 modules (stop 13) and all are different', () => {
  PATTERNS.forEach((p, i) => assert.equal([...p].reduce((a, b) => a + Number(b), 0), i === 106 ? 13 : 11, `symbol ${i}`));
  assert.equal(new Set(PATTERNS).size, 107);
});

test('known example: "Wikipedia" in Code B has check symbol 88', () => {
  const v = code128Values('Wikipedia');
  assert.equal(v[0], 104);
  assert.equal(v.at(-1), 88);
});

test('what is printed scans back as the same text', () => {
  for (const s of ['DEMO-001', 'KENTE-DRESS-M-RED', '6034000123456', '12345', '42', 'a b/c:%']) {
    assert.equal(decode(code128Widths(s)), s, s);
  }
  assert.equal(code128Values('6034000123456')[0], 105, 'digits use the compact Code C');
  assert.ok(code128Widths('6034000123456').length < code128Widths('X034000123456').length);
});

test('bad input is refused; SVG has one bar per black run', () => {
  assert.throws(() => code128Values(''), BarcodeError);
  assert.throws(() => code128Values('Café'), BarcodeError);
  assert.throws(() => code128Values('x'.repeat(49)), BarcodeError);
  const svg = barcodeSvg('AB', { width: 40, height: 10 });
  assert.match(svg, /^<svg .*width="40mm" height="10mm"/);
  assert.equal((svg.match(/M/g) || []).length, Math.ceil(code128Widths('AB').length / 2));
});
