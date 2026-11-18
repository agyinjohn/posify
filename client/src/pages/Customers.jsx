import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, download } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import DataTable from '../DataTable.jsx';
import { dateTime, fmt, METHODS, r2, todayStr } from '../format.js';

export default function Customers() {
  const { isOwner } = useAuth();
  const toast = useToast();
  const [list, setList] = useState(() => cacheGet('/customers?q='));
  const [refreshing, setRefreshing] = useState(false);
  const nav = useLocation();
  const handed = nav.state?.q || ''; // search handed over from the top bar
  const [edit, setEdit] = useState(null);
  const [paying, setPaying] = useState(null);
  const [statement, setStatement] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(() => {
    swrFetch('/customers?q=', { onData: setList, onRefreshing: setRefreshing, ttlMs: 30_000 })
      .catch((e) => toast(e.message, 'err'));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const all = list || [];
  const totalOwed = r2(all.reduce((t, c) => t + (c.balance > 0 ? c.balance : 0), 0));
  const owingCount = all.filter((c) => c.balance > 0).length;
  const columns = [
    { key: 'name', label: 'Customer', render: (c) => (
      <div className="cell-thumb"><span className="ph">{c.name.charAt(0).toUpperCase()}</span><span><strong>{c.name}</strong><small>{c.phone || 'No phone'}</small></span></div>
    ) },
    { key: 'phone', label: 'Phone', className: 'muted-cell', render: (c) => c.phone || '–' },
    { key: 'balance', label: 'Owes', align: 'num', value: (c) => c.balance || 0, render: (c) => (c.balance > 0 ? <span className="owes">{fmt(c.balance)}</span> : <span className="muted-cell">–</span>) },
    ...(isOwner ? [{ key: 'creditLimit', label: 'Credit limit', align: 'num', value: (c) => c.creditLimit || 0, className: 'muted-cell', render: (c) => (c.creditLimit ? fmt(c.creditLimit) : 'No limit') }] : []),
    { key: 'createdAt', kind: 'date', label: 'Added', className: 'muted-cell nowrap', render: (c) => (c.createdAt ? dateTime(c.createdAt).split(',')[0] : '–'), exportValue: (c) => (c.createdAt ? dateTime(c.createdAt) : '') },
    { key: 'acts', label: '', sortable: false, export: false, render: (c) => (
      <div className="cell-actions" onClick={(e) => e.stopPropagation()}>
        {c.balance > 0 && <button onClick={() => setPaying(c)}>Record payment</button>}
        {isOwner && <button onClick={() => setEdit(c)}>Edit</button>}
      </div>
    ) },
  ];
  const filters = [
    { key: 'owing', label: 'Everyone', options: [['yes', 'Owes money'], ['no', 'Owes nothing'], ...(isOwner ? [['over', 'Over credit limit']] : [])],
      test: (c, v) => (v === 'yes' ? c.balance > 0 : v === 'no' ? !(c.balance > 0) : c.creditLimit > 0 && c.balance > c.creditLimit) },
  ];

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      <div className="stat-row">
        <div className="stat-chip"><span>Customers</span><strong>{all.length}</strong></div>
        <div className="stat-chip warn"><span>Owe money</span><strong>{owingCount}</strong></div>
        <div className="stat-chip key"><span>Total owed</span><strong>{fmt(totalOwed)}</strong></div>
      </div>
      {list === null ? <TableSkeleton cols={4} rows={8} /> : (
        <DataTable
          title="Customers" exportName="customers" rows={all} columns={columns} filters={filters}
          searchPlaceholder="Search name or phone" searchText={(c) => `${c.name} ${c.phone || ''}`} initialSearch={handed}
          initialSort={{ key: 'name', dir: 'asc' }} onRowClick={setStatement} emptyText="No customers yet."
          actions={isOwner && (
            <>
              <button onClick={() => setShowImport(true)}>Import</button>
              <button className="primary" onClick={() => setEdit({ name: '', phone: '', creditLimit: 0 })}>Add customer</button>
            </>
          )}
        />
      )}

      {edit && <CustomerForm c={edit} isOwner={isOwner} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {paying && <PayForm c={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); load(); }} />}
      {statement && <StatementModal c={statement} onClose={() => setStatement(null)} />}
      {showImport && <CsvImportModal onClose={() => setShowImport(false)} onSaved={() => { setShowImport(false); load(); }} />}
    </div>
  );
}

function CustomerForm({ c, isOwner, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: c.name, phone: c.phone || '', creditLimit: c.creditLimit || 0 });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(c._id ? `/customers/${c._id}` : '/customers', { method: c._id ? 'PATCH' : 'POST', body: { ...f, creditLimit: Number(f.creditLimit) || 0 } });
      toast('Customer saved'); onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Modal title={c._id ? 'Edit customer' : 'Add customer'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        {isOwner && <Field label="Credit limit (GH₵)" hint="Max amount this customer can owe on credit. 0 means no limit."><input type="number" min="0" step="0.01" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} /></Field>}
        <div className="actions"><button className="primary">Save customer</button></div>
      </form>
    </Modal>
  );
}

function PayForm({ c, onClose, onSaved }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(c.balance));
  const [method, setMethod] = useState('Cash');
  const [note, setNote] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { await api(`/customers/${c._id}/payments`, { method: 'POST', body: { amount: Number(amount), method, note } }); toast('Payment recorded'); onSaved(); }
    catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Modal title={`Payment from ${c.name}`} onClose={onClose}>
      <p>Currently owes <strong>{fmt(c.balance)}</strong>.</p>
      <form onSubmit={save}>
        <Field label="Amount received (GH₵)"><input type="number" min="0.01" step="0.01" max={c.balance} value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
        <Field label="Paid by"><select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="actions"><button className="primary">Record payment</button></div>
      </form>
    </Modal>
  );
}

function StatementModal({ c, onClose }) {
  const toast = useToast();
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api(`/customers/${c._id}/statement?from=${from}&to=${to}`)); }
    catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  }, [c._id, from, to, toast]);

  useEffect(() => { load(); }, [load]);

  const csv = () =>
    download(`/customers/${c._id}/statement?from=${from}&to=${to}&format=csv`, `statement-${c.name}.csv`)
      .catch((e) => toast(e.message, 'err'));

  return (
    <Modal title={`Statement — ${c.name}`} onClose={onClose} wide>
      <div className="sales-topbar">
        <div className="filters">
          <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {data && (
          <div className="sales-summary">
            <div className="sales-stat"><span>Opening balance</span><strong>{fmt(data.openingBalance)}</strong></div>
            <div className="sales-stat key"><span>Closing balance</span><strong>{fmt(data.closingBalance)}</strong></div>
          </div>
        )}
        <button onClick={csv}>Download CSV</button>
      </div>
      {busy && <p className="hint">Loading…</p>}
      {data && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {data.statement.length === 0 && <tr><td colSpan="6" className="empty">No transactions in this period.</td></tr>}
              {data.statement.map((r, i) => (
                <tr key={i}>
                  <td className="muted-cell">{dateTime(r.date)}</td>
                  <td><span className={`badge ${r.type === 'sale' ? 'badge-red' : 'badge-green'}`}>{r.type === 'sale' ? 'Credit sale' : 'Payment'}</span></td>
                  <td><span className="receipt-no">{r.ref}</span></td>
                  <td className="num">{r.debit > 0 ? <span className="owes">{fmt(r.debit)}</span> : '–'}</td>
                  <td className="num">{r.credit > 0 ? <span style={{ color: 'var(--green)' }}>{fmt(r.credit)}</span> : '–'}</td>
                  <td className={`num${r.balance > 0 ? ' owes' : ''}`}><strong>{fmt(r.balance)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function CsvImportModal({ onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState([]); // parsed preview rows
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parseFile = (file) => {
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = e.target.result.split('\n').map((l) => l.trim()).filter(Boolean);
      // Skip header if first cell looks like "name"
      const start = lines[0]?.toLowerCase().startsWith('name') ? 1 : 0;
      const parsed = lines.slice(start).map((line) => {
        const [name, phone = '', creditLimit = '0'] = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        return { name, phone, creditLimit: Number(creditLimit) || 0 };
      }).filter((r) => r.name);
      if (parsed.length === 0) { setError('No valid rows found. Expected columns: name, phone, creditLimit'); return; }
      setRows(parsed);
    };
    reader.readAsText(file);
  };

  const submit = async () => {
    setBusy(true);
    let ok = 0, fail = 0;
    for (const r of rows) {
      try { await api('/customers', { method: 'POST', body: r }); ok++; }
      catch { fail++; }
    }
    setBusy(false);
    toast(`${ok} imported${fail > 0 ? `, ${fail} failed` : ''}`, fail > 0 ? 'err' : 'ok');
    onSaved();
  };

  return (
    <Modal title="Import customers from CSV" onClose={onClose}>
      <p className="hint">CSV columns: <code>name, phone, creditLimit</code>. Phone and credit limit are optional. First row can be a header.</p>
      <Field label="Choose CSV file">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files[0] && parseFile(e.target.files[0])} />
      </Field>
      {error && <div className="error">{error}</div>}
      {rows.length > 0 && (
        <>
          <p className="hint">{rows.length} customer{rows.length !== 1 ? 's' : ''} ready to import:</p>
          <div className="tablewrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Name</th><th>Phone</th><th className="num">Credit limit</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td className="muted-cell">{r.phone || '–'}</td>
                    <td className="num muted-cell">{r.creditLimit ? fmt(r.creditLimit) : 'No limit'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={submit}>
              {busy ? 'Importing…' : `Import ${rows.length} customer${rows.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
