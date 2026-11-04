// Small, dependency-free CSV reader/writer for spreadsheet imports. Handles a leading BOM, quoted cells with
// commas / quotes / line breaks inside, Windows or Unix line ends, and comma, semicolon or tab separators
// (Excel in many countries saves with semicolons).

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

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(esc).join(',')).join('\r\n');

export function downloadText(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: `${type};charset=utf-8` })); // BOM so Excel reads ₵ and accents
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}
