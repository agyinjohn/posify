// Search, filter, sort and page a list for DataTable. Pure, so it is unit tested (client/test/tableUtils.test.js).

const norm = (v) => String(v ?? '').toLowerCase();

// The value a column sorts and exports by: its `value(row)`, else row[key].
export const cellValue = (col, row) => (col.value ? col.value(row) : row[col.key]);

export function compareValues(a, b) {
  const blank = (v) => v === null || v === undefined || v === '';
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1; // blanks always last
  if (blank(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date || b instanceof Date) return new Date(a) - new Date(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * rows: the full list. search: text typed; searchText(row): the text it is matched against (default: every column).
 * filters: [{ key, test(row, value) }] with values { key: value } ('' = all). sort: { key, dir: 'asc'|'desc' }.
 */
export function applyTable(rows, { columns = [], search = '', searchText, filters = [], values = {}, sort, page = 1, pageSize = 25 } = {}) {
  const words = norm(search).split(/\s+/).filter(Boolean);
  const text = searchText || ((r) => columns.map((c) => cellValue(c, r)).join(' '));
  let out = rows.filter((r) => {
    if (words.length) { const t = norm(text(r)); if (!words.every((w) => t.includes(w))) return false; }
    return filters.every((f) => values[f.key] === undefined || values[f.key] === '' || f.test(r, values[f.key]));
  });
  const col = sort && columns.find((c) => c.key === sort.key);
  if (col) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    out = out.map((r, i) => [r, i]).sort((x, y) => {
      const c = compareValues(cellValue(col, x[0]), cellValue(col, y[0]));
      const blankX = cellValue(col, x[0]) == null || cellValue(col, x[0]) === '';
      const blankY = cellValue(col, y[0]) == null || cellValue(col, y[0]) === '';
      if (blankX !== blankY) return blankX ? 1 : -1; // blanks last in both directions
      return c * dir || x[1] - y[1]; // stable
    }).map(([r]) => r);
  }
  const size = pageSize === 'all' ? Math.max(out.length, 1) : pageSize;
  const pages = Math.max(1, Math.ceil(out.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: out, total: out.length, pages, page: p, pageRows: out.slice((p - 1) * size, p * size), from: out.length ? (p - 1) * size + 1 : 0, to: Math.min(p * size, out.length) };
}

// Page buttons to show: first, last, the current one and its neighbours, with gaps as null ("…").
export function pageList(page, pages) {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...want].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => { if (i && n - sorted[i - 1] > 1) out.push(null); out.push(n); });
  return out;
}

// Rows for a spreadsheet: a title row of column labels, then each row's export values.
export function exportRows(columns, rows) {
  const cols = columns.filter((c) => c.export !== false && c.label);
  return [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => {
    const v = c.exportValue ? c.exportValue(r) : cellValue(c, r);
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === 'object') return v.name ?? ''; // e.g. a populated { name }
    return v ?? '';
  }))];
}
