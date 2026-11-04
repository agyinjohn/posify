import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { cacheInvalidatePrefix } from '../cache.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { parseCsv, toCsv, downloadText } from '../csv.js';
import { fmt, qtyFmt } from '../format.js';

const TEMPLATE_HEADERS = [
  'name', 'sku', 'barcode', 'category', 'pieces per pack', 'pack name',
  'cost per piece', 'cost per pack', 'price per piece', 'price per pack', 'opening stock (pieces)', 'opening stock (packs)', 'reorder level',
];
// Three typical shapes: carton prices only, piece (retail) and carton (wholesale) prices together, piece only.
const TEMPLATE_ROWS = [
  ['Frytol Cooking Oil 5L', 'OIL5', '', 'Oils', 12, 'ctn', '', 96, '', 120, '', 5, 6],
  ['Gino Tomato Mix', 'GTM', '6001234567890', 'Provisions', 50, 'carton', 0.9, '', 1, 40, '', 2, 10],
  ['Salt 500g', 'SALT', '', 'Provisions', '', '', 1, '', 3, '', 100, '', 20],
];

const STATUS = {
  create: { label: 'Add', cls: 'badge-green' },
  update: { label: 'Update', cls: 'badge-amber' },
  skip: { label: 'Skip', cls: '' },
  error: { label: 'Fix', cls: 'badge-red' },
};
const MAX_SHOWN = 200;

function Prices({ p }) {
  if (!p) return null;
  return (
    <span className="muted-cell">
      Cost {fmt(p.cost)} · Retail {fmt(p.retail)}
      {p.units > 1 && <> · {p.packRetail > 0 ? `${fmt(p.packRetail)} per pack of ${p.units}` : `pack of ${p.units}`}</>}
      {p.stock > 0 && <> · Stock {qtyFmt(p.stock)}</>}
    </span>
  );
}

export default function ProductImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);       // { name, headers, rows }
  const [mode, setMode] = useState('skip');
  const [preview, setPreview] = useState(null);  // server dry-run answer
  const [result, setResult] = useState(null);    // after importing
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);

  const readFile = (f) => {
    setError(''); setPreview(null); setResult(null);
    if (f.size > 2 * 1024 * 1024) return setError('That file is too big (2 MB at most). Split it into smaller files.');
    if (/\.xlsx?$/i.test(f.name)) return setError('Save the spreadsheet as CSV first (File → Save As → CSV), then choose that file.');
    const reader = new FileReader();
    reader.onload = () => {
      const all = parseCsv(String(reader.result));
      if (all.length < 2) return setError('The file needs a first row of column titles and at least one product row.');
      if (all.length - 1 > 2000) return setError(`${all.length - 1} rows is too many for one import. Use up to 2000 rows per file.`);
      setFile({ name: f.name, headers: all[0], rows: all.slice(1) });
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(f);
  };

  // Check the whole file on the server (nothing is saved) whenever the file or the duplicate-handling choice changes.
  useEffect(() => {
    if (!file) return undefined;
    let live = true;
    setBusy(true); setError('');
    api('/products/import', { method: 'POST', body: { headers: file.headers, rows: file.rows, mode, dryRun: true } })
      .then((r) => { if (live) { setPreview(r); setOnlyProblems(r.summary.error > 0); } })
      .catch((e) => { if (live) { setPreview(null); setError(e.message); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [file, mode]);

  const doImport = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('/products/import', { method: 'POST', body: { headers: file.headers, rows: file.rows, mode, dryRun: false } });
      cacheInvalidatePrefix('/products');
      setResult(r);
      toast(`${r.summary.created} added, ${r.summary.updated} updated`);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const shown = useMemo(() => {
    const list = preview?.rows ?? [];
    const f = onlyProblems ? list.filter((r) => r.status === 'error' || r.warnings.length) : list;
    return f.slice(0, MAX_SHOWN);
  }, [preview, onlyProblems]);

  const s = preview?.summary;
  const toWrite = s ? s.create + s.update : 0;

  const downloadProblems = () => {
    const rows = preview.rows.filter((r) => r.status === 'error').map((r) => [r.row, r.name, r.sku, r.errors.join('; ')]);
    downloadText('import-problems.csv', toCsv([['row', 'name', 'sku', 'problem'], ...rows]));
  };

  // ── Finished ──
  if (result) {
    const bad = result.rows.filter((r) => r.status === 'error');
    return (
      <Modal title="Import finished" onClose={() => onDone()} wide>
        <div className="report-kpis">
          <div className="report-kpi ok"><span>Added</span><strong>{result.summary.created}</strong></div>
          <div className="report-kpi"><span>Updated</span><strong>{result.summary.updated}</strong></div>
          <div className="report-kpi"><span>Skipped (already there)</span><strong>{result.summary.skipped}</strong></div>
          <div className={`report-kpi${result.summary.failed ? ' warn' : ''}`}><span>Not imported</span><strong>{result.summary.failed}</strong></div>
        </div>
        {bad.length > 0 && (
          <>
            <p className="hint">These rows were not imported. Fix them in your spreadsheet and import the file again with "Skip products that already exist", so only the fixed ones are added.</p>
            <ul className="import-problems">{bad.slice(0, 50).map((r) => <li key={r.row}><strong>Row {r.row}</strong> {r.name}: {r.errors.join('; ')}</li>)}</ul>
          </>
        )}
        <div className="actions"><button className="primary" onClick={() => onDone()}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title="Import products from a spreadsheet" onClose={onClose} wide>
      {/* ── Step 1: choose a file ── */}
      <p className="hint">
        Use a spreadsheet with one product per row and column titles in the first row. Save it as <strong>CSV</strong> (in Excel: File → Save As → CSV) and choose it below.
        Single pieces sell at the price per piece (retail) and a full pack at the price per pack (wholesale); give either or both and an empty one is worked out from the other.
      </p>
      <div className="import-actions">
        <button type="button" onClick={() => downloadText('products-template.csv', toCsv([TEMPLATE_HEADERS, ...TEMPLATE_ROWS]))}>Download a template</button>
      </div>
      <Field label="CSV file" hint={file ? `${file.name}: ${file.rows.length} row${file.rows.length !== 1 ? 's' : ''}` : 'Up to 2000 products per file'}>
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files[0] && readFile(e.target.files[0])} />
      </Field>
      {error && <div className="error">{error}</div>}

      {/* ── Step 2: review ── */}
      {file && (
        <fieldset className="import-mode">
          <legend>If a product with the same SKU already exists</legend>
          <label className="check"><input type="radio" name="mode" checked={mode === 'skip'} onChange={() => setMode('skip')} /> Skip it (leave it as it is)</label>
          <label className="check"><input type="radio" name="mode" checked={mode === 'update'} onChange={() => setMode('update')} /> Update its details and prices (stock is never changed)</label>
        </fieldset>
      )}
      {busy && !result && file && <p className="hint">Checking your file…</p>}

      {preview && (
        <>
          <div className="chips-row">
            <span className="chip chip-green">{s.create} to add</span>
            {s.update > 0 && <span className="chip">{s.update} to update</span>}
            {s.skip > 0 && <span className="chip chip-muted">{s.skip} skipped</span>}
            {s.error > 0 && <span className="chip chip-red">{s.error} need fixing</span>}
            {s.warnings > 0 && <span className="chip">{s.warnings} with notes</span>}
          </div>
          <p className="hint">
            Columns used: {preview.columns.recognized.map((c) => c.header).join(', ') || 'none'}.
            {preview.columns.ignored.length > 0 && <> Ignored: {preview.columns.ignored.join(', ')}.</>}
          </p>

          <label className="check" style={{ margin: '.4rem 0' }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems or notes
          </label>
          {shown.length > 0 ? (
            <div className="tablewrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Row</th><th>Product</th><th>Prices</th><th>Result</th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.row} className={r.status === 'error' ? 'warn' : ''}>
                      <td className="muted-cell">{r.row}</td>
                      <td><strong>{r.name || '(no name)'}</strong><br /><small>{r.sku}</small></td>
                      <td><Prices p={r.prices} /></td>
                      <td>
                        <span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                        {r.errors.map((m) => <div key={m} className="import-msg err">{m}</div>)}
                        {r.warnings.map((m) => <div key={m} className="import-msg">{m}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="hint">{onlyProblems ? 'No problems found.' : 'No rows.'}</p>}
          {(preview.rows.length > MAX_SHOWN && !onlyProblems) && <p className="hint">Showing the first {MAX_SHOWN} of {preview.rows.length} rows.</p>}

          <div className="actions">
            {s.error > 0 && <button type="button" onClick={downloadProblems}>Download problem rows</button>}
            <button className="primary" disabled={busy || toWrite === 0} onClick={doImport}>
              {busy ? 'Working…' : toWrite === 0 ? 'Nothing to import' : `Import ${toWrite} product${toWrite !== 1 ? 's' : ''}`}
            </button>
          </div>
          {s.error > 0 && toWrite > 0 && <p className="hint">The {s.error} row{s.error !== 1 ? 's' : ''} marked "Fix" will be left out. You can fix them and import again.</p>}
        </>
      )}
    </Modal>
  );
}
