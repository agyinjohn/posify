// Code 128 barcodes (what every handheld scanner reads), drawn as SVG. Pure, so it is unit tested
// (client/test/barcode.test.js). Code C packs pairs of digits; Code B covers letters, digits and symbols.

// Bar/space widths for symbol values 0–106 (106 = stop, 7 widths).
export const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104; const START_C = 105; const CODE_B = 100; const CODE_C = 99; const STOP = 106;

export class BarcodeError extends Error {}

// Symbol values for the text, including start code and check symbol (stop not included).
export function code128Values(text) {
  const s = String(text ?? '');
  if (!s) throw new BarcodeError('Nothing to encode');
  if (s.length > 48) throw new BarcodeError('Too long for a label barcode (48 characters at most)');
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new BarcodeError(`"${ch}" cannot go in a barcode`);
  }
  const values = [];
  const allDigits = /^\d+$/.test(s);
  let i = 0;
  if (allDigits && s.length >= 4) {
    // Code C for pairs of digits; an odd last digit goes in Code B.
    values.push(START_C);
    for (; i + 1 < s.length; i += 2) values.push(Number(s.slice(i, i + 2)));
    if (i < s.length) { values.push(CODE_B); values.push(s.charCodeAt(i) - 32); }
  } else {
    values.push(START_B);
    for (; i < s.length; i++) values.push(s.charCodeAt(i) - 32);
  }
  const check = values.reduce((sum, v, k) => sum + v * (k === 0 ? 1 : k), 0) % 103;
  return [...values, check];
}

// Widths of alternating bar, space, bar… from start to stop (in modules).
export function code128Widths(text) {
  return [...code128Values(text), STOP].flatMap((v) => PATTERNS[v].split('').map(Number));
}

// An SVG barcode, `width` × `height` in the given unit; quiet zones of 10 modules either side.
export function barcodeSvg(text, { width = 50, height = 12, unit = 'mm' } = {}) {
  const widths = code128Widths(text);
  const modules = widths.reduce((a, b) => a + b, 0) + 20;
  let x = 10; let path = '';
  widths.forEach((w, k) => { if (k % 2 === 0) path += `M${x} 0h${w}v1h-${w}z`; x += w; });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}${unit}" height="${height}${unit}" viewBox="0 0 ${modules} 1" preserveAspectRatio="none" shape-rendering="crispEdges"><path d="${path}" fill="#000"/></svg>`;
}

// How many modules wide (to check a barcode will scan at a given printed width).
export const barcodeModules = (text) => code128Widths(text).reduce((a, b) => a + b, 0) + 20;

export { CODE_B, CODE_C, START_B, START_C, STOP };
