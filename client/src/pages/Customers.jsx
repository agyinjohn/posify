import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';
import { dateTime, fmt, METHODS, todayStr } from '../format.js';

export default function Customers() {
  const { isOwner } = useAuth();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);
  const [edit, setEdit] = useState(null);
  const [paying, setPaying] = useState(null);
  const [statement, setStatement] = useState(null);

  const load = useCallback(() => {
    api(`/customers?q=${encodeURIComponent(q)}${owing ? '&owing=1' : ''}`).then(setList).catch((e) => toast(e.message, 'err'));
  }, [q, owing, toast]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <div className="head"><h1>Customers</h1><button className="primary" onClick={() => setEdit({ name: '', phone: '', creditLimit: 0 })}>Add customer</button></div>
      <div className="filters">
        <input className="search" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} /> Only customers who owe</label>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th className="num">Owes</th>{isOwner && <th className="num">Credit limit</th>}<th></th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c._id}><td>{c.name}</td><td>{c.phone || '–'}</td>
              <td className={`num${c.balance > 0 ? ' owes' : ''}`}>{fmt(c.balance)}</td>
              {isOwner && <td className="num">{c.creditLimit ? fmt(c.creditLimit) : 'No limit'}</td>}
              <td className="acts">{c.balance > 0 && <button onClick={() => setPaying(c)}>Record payment</button>}
                <button onClick={() => setStatement(c)}>Statement</button>
                {isOwner && <button onClick={() => setEdit(c)}>Edit</button>}</td></tr>
          ))}
          {list.length === 0 && <tr><td colSpan="5" className="empty">No customers found.</td></tr>}
        </tbody>
      </table></div>
      {edit && <CustomerForm c={edit} isOwner={isOwner} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {paying && <PayForm c={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); load(); }} />}
      {statement && <StatementModal c={statement} onClose={() => setStatement(null)} />}
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
        {isOwner && <Field label="Credit limit (GH₵)" hint="0 means no limit"><input type="number" min="0" step="0.01" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} /></Field>}
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
      <div className="filters">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} /></Field>
        <button onClick={csv}>Download CSV</button>
      </div>
      {busy && <p className="hint">Loading…</p>}
      {data && (
        <>
          <div className="stats">
            <div><span>Opening balance</span><strong>{fmt(data.openingBalance)}</strong></div>
            <div className="key"><span>Closing balance</span><strong>{fmt(data.closingBalance)}</strong></div>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {data.statement.length === 0 && <tr><td colSpan="6" className="empty">No transactions in this period.</td></tr>}
              {data.statement.map((r, i) => (
                <tr key={i}>
                  <td>{dateTime(r.date)}</td>
                  <td>{r.type === 'sale' ? 'Credit sale' : 'Payment'}</td>
                  <td>{r.ref}</td>
                  <td className={`num${r.debit > 0 ? ' owes' : ''}`}>{r.debit > 0 ? fmt(r.debit) : '–'}</td>
                  <td className="num">{r.credit > 0 ? fmt(r.credit) : '–'}</td>
                  <td className={`num${r.balance > 0 ? ' owes' : ''}`}>{fmt(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </Modal>
  );
}
