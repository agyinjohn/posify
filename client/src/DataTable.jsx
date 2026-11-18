import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, FileSpreadsheet, FileText, Search, X } from 'lucide-react';
import { applyTable, cellValue, exportRows, pageList } from './tableUtils.js';
import { toCsv, downloadText } from './csv.js';
import { SHOP_NAME, todayStr } from './format.js';

/**
 * One table for every list: search, filter dropdowns, sortable columns, page numbers, ticked rows with bulk
 * actions, and export to a spreadsheet (CSV) or PDF (print). Below 640px rows become cards (responsiveTables.js).
 *
 * columns: [{ key, label, render?(row), value?(row) for sorting/export, exportValue?(row), align?: 'num', sortable?: false,
 *   export?: false (shown, not exported), hidden?: true (exported, not shown), kind?: 'date' }]
 * filters: [{ key, label, options: [[value, label]], test(row, value) }]
 */
// Plain cell text: never hand React a raw object (e.g. a populated { name }).
const show = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? (v.name ?? '') : v);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function DataTable({
  rows, columns, rowKey = (r) => r._id, title = 'List', exportName,
  searchPlaceholder = 'Search', searchText, filters = [], initialSort, initialSearch = '',
  onRowClick, rowClass, selectable = false, bulkActions, toolbar, actions, emptyText = 'Nothing to show.',
  pageSizes = [10, 25, 50, 100], defaultPageSize = 25,
}) {
  const [search, setSearch] = useState(initialSearch);
  const [values, setValues] = useState({});
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [picked, setPicked] = useState(() => new Set());
  useEffect(() => { setSearch(initialSearch); }, [initialSearch]);
  useEffect(() => { setPage(1); }, [search, values, pageSize]);

  const shown = columns.filter((c) => !c.hidden);
  const t = useMemo(() => applyTable(rows || [], { columns, search, searchText, filters, values, sort, page, pageSize }),
    [rows, columns, search, searchText, filters, values, sort, page, pageSize]);
  // Forget ticks for rows that are no longer in the list.
  const keys = useMemo(() => new Set((rows || []).map(rowKey)), [rows, rowKey]);
  const pickedRows = t.rows.filter((r) => picked.has(rowKey(r)) && keys.has(rowKey(r)));
  const allOnPage = t.pageRows.length > 0 && t.pageRows.every((r) => picked.has(rowKey(r)));
  const toggle = (k) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const togglePage = () => setPicked((s) => { const n = new Set(s); t.pageRows.forEach((r) => (allOnPage ? n.delete(rowKey(r)) : n.add(rowKey(r)))); return n; });
  const clearPicked = () => setPicked(new Set());

  const sortBy = (c) => {
    if (c.sortable === false) return;
    setSort((s) => (s?.key !== c.key ? { key: c.key, dir: c.align === 'num' || c.kind === 'date' ? 'desc' : 'asc' } : s.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' }));
  };
  const filtered = search || Object.values(values).some((v) => v !== '' && v !== undefined);
  const exportList = pickedRows.length ? pickedRows : t.rows;
  const fileBase = `${exportName || title.toLowerCase().replace(/\s+/g, '-')}-${todayStr()}`;

  const toCsvFile = () => downloadText(`${fileBase}.csv`, toCsv(exportRows(columns, exportList)));
  const toPdf = () => {
    const [head, ...body] = exportRows(columns, exportList);
    const nums = new Set(columns.filter((c) => c.export !== false && c.label).map((c, i) => (c.align === 'num' ? i : -1)));
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:12px/1.4 'Public Sans',system-ui,sans-serif;color:#17212B;margin:24px}h1{font-size:18px;margin:0}p{color:#5B6773;margin:2px 0 14px}
      table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E4E8EC;vertical-align:top}
      th{background:#F4F6F8;font-size:11px;text-transform:uppercase;letter-spacing:.04em}td.n,th.n{text-align:right}
      @page{margin:14mm}</style></head><body><h1>${esc(SHOP_NAME)} · ${esc(title)}</h1>
      <p>${esc(new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))} · ${exportList.length} row${exportList.length === 1 ? '' : 's'}${pickedRows.length ? ' (ticked)' : filtered ? ' (filtered)' : ''}</p>
      <table><thead><tr>${head.map((h, i) => `<th class="${nums.has(i) ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map((r) => `<tr>${r.map((v, i) => `<td class="${nums.has(i) ? 'n' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="dt">
      <div className="dt-bar">
        <div className="dt-search">
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          {search && <button type="button" className="dt-clear" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
        </div>
        {filters.map((f) => (
          <select key={f.key} className="dt-filter" value={values[f.key] ?? ''} aria-label={f.label}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
            <option value="">{f.label}</option>
            {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        {/* Phones show rows as cards with no column headers, so sorting gets its own menu there. */}
        <select className="dt-filter dt-sort-mobile" aria-label="Sort by" value={sort ? `${sort.key}:${sort.dir}` : ''}
          onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort(key ? { key, dir } : null); }}>
          <option value="">Sort by</option>
          {shown.filter((c) => c.label && c.sortable !== false).flatMap((c) => [
            <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} {c.kind === 'date' ? '(oldest first)' : c.align === 'num' ? '(low to high)' : '(A to Z)'}</option>,
            <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} {c.kind === 'date' ? '(newest first)' : c.align === 'num' ? '(high to low)' : '(Z to A)'}</option>,
          ])}
        </select>
        {filtered && <button type="button" className="dt-reset" onClick={() => { setSearch(''); setValues({}); }}>Clear filters</button>}
        {toolbar}
        <div className="dt-bar-end">
          <button type="button" className="dt-export" onClick={toCsvFile} title="Download for Excel (CSV)"><FileSpreadsheet size={16} /> <span>Excel</span></button>
          <button type="button" className="dt-export" onClick={toPdf} title="Print or save as PDF"><FileText size={16} /> <span>PDF</span></button>
          {actions}
        </div>
      </div>

      {selectable && pickedRows.length > 0 && (
        <div className="dt-bulk" role="status">
          <span><strong>{pickedRows.length}</strong> ticked</span>
          {bulkActions?.(pickedRows, clearPicked)}
          <button type="button" className="ghost" onClick={clearPicked}>Clear</button>
        </div>
      )}

      <div className="tablewrap dt-wrap">
        <table className="dt-table">
          <thead>
            <tr>
              {selectable && <th className="dt-check"><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Tick all on this page" /></th>}
              {shown.map((c) => {
                const on = sort?.key === c.key;
                const Icon = !on ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
                return (
                  <th key={c.key} className={`${c.align === 'num' ? 'num' : ''}${c.sortable === false || !c.label ? '' : ' dt-sortable'}${on ? ' on' : ''}`}
                    aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortable === false || !c.label ? c.label : (
                      <button type="button" onClick={() => sortBy(c)}>{c.label}<Icon size={13} aria-hidden="true" /></button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {t.pageRows.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} className={`${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''} ${picked.has(k) ? 'picked' : ''}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {selectable && <td className="dt-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} aria-label="Tick row" /></td>}
                  {shown.map((c) => (
                    <td key={c.key} className={`${c.align === 'num' ? 'num' : ''} ${c.className || ''}`}>{c.render ? c.render(r) : show(cellValue(c, r))}</td>
                  ))}
                </tr>
              );
            })}
            {t.total === 0 && (
              <tr><td colSpan={shown.length + (selectable ? 1 : 0)} className="empty">{filtered ? 'Nothing matches your search or filters.' : emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {t.total > 0 && (
        <div className="dt-foot">
          <label className="dt-size">
            Rows per page
            <select value={pageSize} onChange={(e) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="all">All</option>
            </select>
          </label>
          <span className="dt-count">{t.from}–{t.to} of {t.total}{(rows || []).length !== t.total ? ` (from ${(rows || []).length})` : ''}</span>
          {t.pages > 1 && (
            <nav className="dt-pages" aria-label="Pages">
              <button type="button" onClick={() => setPage(t.page - 1)} disabled={t.page <= 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
              {pageList(t.page, t.pages).map((n, i) => (n === null
                ? <span key={`g${i}`} className="dt-gap">…</span>
                : <button type="button" key={n} className={n === t.page ? 'on' : ''} onClick={() => setPage(n)} aria-current={n === t.page ? 'page' : undefined}>{n}</button>))}
              <button type="button" onClick={() => setPage(t.page + 1)} disabled={t.page >= t.pages} aria-label="Next page"><ChevronRight size={16} /></button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
