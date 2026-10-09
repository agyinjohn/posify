import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { dateTime, fmt, qtyFmt } from '../format.js';

export default function Suppliers() {
  const [tab, setTab] = useState('suppliers');
  return (
    <div className="page">
      <h1>Suppliers</h1>
      <div className="seg" role="tablist">
        {[['suppliers', 'Suppliers'], ['pos', 'Purchase Orders']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'suppliers' && <SupplierList />}
      {tab === 'pos' && <POList />}
    </div>
  );
}

// ── Suppliers ────────────────────────────────────────────────────────────────

function SupplierList() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => {
    api(`/suppliers?q=${encodeURIComponent(q)}`).then(setList).catch((e) => toast(e.message, 'err'));
  }, [q, toast]);
  useEffect(load, [load]);

  return (
    <>
      <div className="filters">
        <input className="search" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" onClick={() => setEdit({ name: '', phone: '', email: '', address: '', notes: '' })}>Add supplier</button>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th></th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s._id}>
              <td>{s.name}</td><td>{s.phone || '—'}</td><td>{s.email || '—'}</td><td>{s.address || '—'}</td>
              <td className="acts"><button onClick={() => setEdit(s)}>Edit</button></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan="5" className="empty">No suppliers yet.</td></tr>}
        </tbody>
      </table></div>
      {edit && <SupplierForm s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function SupplierForm({ s, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !s._id;
  const [f, setF] = useState({ name: s.name, phone: s.phone || '', email: s.email || '', address: s.address || '', notes: s.notes || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(isNew ? '/suppliers' : `/suppliers/${s._id}`, { method: isNew ? 'POST' : 'PATCH', body: f });
      toast('Supplier saved'); onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Modal title={isNew ? 'Add supplier' : `Edit ${s.name}`} onClose={onClose}>
      <form onSubmit={save} className="grid2">
        <Field label="Name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Address"><input value={f.address} onChange={set('address')} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={set('notes')} /></Field>
        <div className="actions span2"><button className="primary">Save supplier</button></div>
      </form>
    </Modal>
  );
}

// ── Purchase Orders ──────────────────────────────────────────────────────────

function POList() {
  const toast = useToast();
  const [pos, setPos] = useState([]);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    api(`/purchase-orders${status ? `?status=${status}` : ''}`).then(setPos).catch((e) => toast(e.message, 'err'));
  }, [status, toast]);
  useEffect(load, [load]);

  const markOrdered = async (id) => {
    try { await api(`/purchase-orders/${id}/order`, { method: 'POST' }); toast('Marked as ordered'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const receive = async (id) => {
    try { await api(`/purchase-orders/${id}/receive`, { method: 'POST' }); toast('Stock received'); load(); setViewing(null); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="ordered">Ordered</option>
          <option value="received">Received</option>
        </select>
        <button className="primary" onClick={() => setCreating(true)}>New purchase order</button>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Date</th><th>Supplier</th><th className="num">Total</th><th>Status</th><th>Note</th><th></th></tr></thead>
        <tbody>
          {pos.map((po) => (
            <tr key={po._id} className={po.status === 'received' ? 'voided' : ''}>
              <td>{dateTime(po.createdAt)}</td>
              <td>{po.supplier?.name ?? po.supplierName}</td>
              <td className="num">{fmt(po.total)}</td>
              <td>{po.status}</td>
              <td>{po.note || '—'}</td>
              <td className="acts">
                <button onClick={() => setViewing(po._id)}>View</button>
                {po.status === 'draft' && <button onClick={() => markOrdered(po._id)}>Mark ordered</button>}
                {po.status !== 'received' && <button className="primary" onClick={() => receive(po._id)}>Receive stock</button>}
              </td>
            </tr>
          ))}
          {pos.length === 0 && <tr><td colSpan="6" className="empty">No purchase orders.</td></tr>}
        </tbody>
      </table></div>
      {creating && <POForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {viewing && <PODetail id={viewing} onClose={() => setViewing(null)} onReceive={() => { receive(viewing); }} />}
    </>
  );
}

function POForm({ onClose, onSaved }) {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ productId: '', qty: 1, unitCost: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/suppliers').then(setSuppliers).catch(() => {});
    api('/products?all=1').then(setProducts).catch(() => {});
  }, []);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((ls) => [...ls, { productId: '', qty: 1, unitCost: '' }]);
  const removeLine = (i) => setLines((ls) => ls.filter((_, j) => j !== i));

  const onProductChange = (i, productId) => {
    const p = products.find((p) => p._id === productId);
    setLine(i, { productId, unitCost: p ? String(p.costPrice) : '' });
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api('/purchase-orders', {
        method: 'POST',
        body: {
          supplierId,
          note,
          lines: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitCost: Number(l.unitCost) || 0 })),
        },
      });
      toast('Purchase order created'); onSaved();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="Supplier">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit cost (GH₵)</th><th className="num">Line total</th><th></th></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const lineTotal = (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
              return (
                <tr key={i}>
                  <td>
                    <select value={l.productId} onChange={(e) => onProductChange(i, e.target.value)} required>
                      <option value="">Choose product</option>
                      {products.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </td>
                  <td><input type="number" min="0.001" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} required style={{ width: '5rem' }} /></td>
                  <td><input type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} required style={{ width: '7rem' }} /></td>
                  <td className="num">{fmt(lineTotal)}</td>
                  <td><button type="button" className="ghost" onClick={() => removeLine(i)} disabled={lines.length === 1}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <div className="actions">
          <button type="button" onClick={addLine}>+ Add line</button>
          <button className="primary" disabled={busy}>Create PO</button>
        </div>
      </form>
    </Modal>
  );
}

function PODetail({ id, onClose, onReceive }) {
  const toast = useToast();
  const [po, setPo] = useState(null);

  useEffect(() => {
    api(`/purchase-orders/${id}`).then(setPo).catch((e) => toast(e.message, 'err'));
  }, [id, toast]);

  if (!po) return null;

  return (
    <Modal title={`PO — ${po.supplier?.name ?? po.supplierName}`} onClose={onClose} wide>
      <div className="stats">
        <div><span>Status</span><strong>{po.status}</strong></div>
        <div><span>Created</span><strong>{dateTime(po.createdAt)}</strong></div>
        <div className="key"><span>Total</span><strong>{fmt(po.total)}</strong></div>
        {po.receivedAt && <div><span>Received</span><strong>{dateTime(po.receivedAt)}</strong></div>}
      </div>
      {po.note && <p className="hint">{po.note}</p>}
      <div className="tablewrap"><table>
        <thead><tr><th>Product</th><th>SKU</th><th className="num">Ordered</th><th className="num">Unit cost</th><th className="num">Line total</th><th className="num">In stock now</th></tr></thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td><td>{l.sku}</td>
              <td className="num">{qtyFmt(l.qty)}</td>
              <td className="num">{fmt(l.unitCost)}</td>
              <td className="num">{fmt(l.lineTotal)}</td>
              <td className="num">{l.product?.stock != null ? qtyFmt(l.product.stock) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {po.status !== 'received' && (
        <div className="actions">
          <button className="primary" onClick={onReceive}>Receive all stock</button>
        </div>
      )}
    </Modal>
  );
}
