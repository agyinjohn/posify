// Escapes values and neutralises spreadsheet formula injection (=, +, -, @).
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (headers, rows) =>
  [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');

// Reading CSV (same reader as the browser's client/src/csv.js), for server-side scripts like import-products.

function detectDelimiter(text) {
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) { if (counts[','] + counts[';'] + counts['\t'] > 0) break; }
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/** text -> array of rows (each an array of trimmed strings). Blank rows are dropped. */
export function parseCsv(input) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const endCell = () => { row.push(cell.trim()); cell = ''; };
  const endRow = () => { endCell(); if (row.some((c) => c !== '')) rows.push(row); row = []; };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delim) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i += 1; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}
