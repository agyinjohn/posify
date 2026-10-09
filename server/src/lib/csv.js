// Escapes values and neutralises spreadsheet formula injection (=, +, -, @).
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (headers, rows) =>
  [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
