import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { dateTime, fmt, qtyFmt } from '../format.js';

const PO_STATUS_CLASS = { draft: 'badge-amber', ordered: 'badge-green', received: 'badge-red' };
const TABS = [['suppliers', 'Suppliers'], ['pos', 'Purchase Orders']];

export default function Suppliers() {
  const [tab, setTab] = useState('suppliers');
  return (
    <div className="page">
      <div className="tab-bar">
        {TABS.map(([k, l]) => (
          <button key={k} className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'suppliers' && <SupplierList />}
      {tab === 'pos' && <POList />}
    </div>
  );
}

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
    <div style={{ marginTop: '1rem' }}>
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <input className="search" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          {list.length > 0 && <span className="chip">{list.length} supplier{list.length !== 1 ? 's' : ''}</span>}
        </div>
        <button className="primary" onClick={() => setEdit({ name: '', phone: '', email: '', address: '', notes: '' })}>Add supplier</button>
      </div>

      <div className="supplier-grid">
        {list.map((s) => (
          <div key={s._id} className="supplier-card" onClick={() => setEdit(s)}>
            <div className="supplier-avatar">{s.name.charAt(0).toUpperCase()}</div>
            <div className="supplier-info">
              <div className="supplier-name">{s.name}</div>
              {s.phone && <div className="supplier-detail">{s.phone}</div>}
              {s.email && <div className="supplier-detail">{s.email}</div>}
              {s.address && <div className="supplier-detail muted-cell">{s.address}</div>}
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="product-grid-empty">No suppliers yet. Add your first supplier.</div>}
      </div>

      {edit && <SupplierForm s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
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
        <Field label="Notes" ><input value={f.notes} onChange={set('notes')} /></Field>
        <div className="actions span2"><button className="primary">Save supplier</button></div>
      </form>
    </Modal>
  );
}

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

  const draft = pos.filter((p) => p.status === 'draft').length;
  const ordered = pos.filter((p) => p.status === 'ordered').length;

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="ordered">Ordered</option>
            <option value="received">Received</option>
          </select>
          {draft > 0 && <span className="chip chip-red">{draft} draft</span>}
          {ordered > 0 && <span className="chip">{ordered} ordered</span>}
        </div>
        <button className="primary" onClick={() => setCreating(true)}>New purchase order</button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Supplier</th><th className="num">Total</th><th>Status</th><th>Note</th><th></th></tr>
          </thead>
          <tbody>
            {pos.map((po) => (
              <tr key={po._id} onClick={() => setViewing(po._id)} style={{ cursor: 'pointer' }}>
                <td className="muted-cell">{dateTime(po.createdAt)}</td>
                <td><strong>{po.supplier?.name ?? po.supplierName}</strong></td>
                <td className="num"><strong>{fmt(po.total)}</strong></td>
                <td><span className={`badge ${PO_STATUS_CLASS[po.status] || ''}`}>{po.status}</span></td>
                <td className="muted-cell">{po.note || '–'}</td>
                <td className="acts" onClick={(e) => e.stopPropagation()}>
                  {po.status === 'draft' && <button onClick={() => markOrdered(po._id)}>Mark ordered</button>}
                  {po.status !== 'received' && <button className="primary" onClick={() => receive(po._id)}>Receive</button>}
                </td>
              </tr>
            ))}
            {pos.length === 0 && <tr><td colSpan="6" className="empty">No purchase orders.</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && <POForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {viewing && <PODetail id={viewing} onClose={() => setViewing(null)} onReceive={() => receive(viewing)} />}
    </div>
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

  const grandTotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api('/purchase-orders', {
        method: 'POST',
        body: { supplierId, note, lines: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitCost: Number(l.unitCost) || 0 })) },
      });
      toast('Purchase order created'); onSaved();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="grid2">
          <Field label="Supplier">
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="tablewrap">
          <table>
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
                    <td className="num"><strong>{fmt(lineTotal)}</strong></td>
                    <td><button type="button" className="ghost" onClick={() => removeLine(i)} disabled={lines.length === 1}>✕</button></td>
                  </tr>
                );
              })}
              <tr className="sum">
                <td colSpan="3">Total</td>
                <td className="num">{fmt(grandTotal)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
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
      <div className="report-kpis" style={{ marginBottom: '1rem' }}>
        <div className="report-kpi key"><span>Total</span><strong>{fmt(po.total)}</strong></div>
        <div className="report-kpi"><span>Status</span><strong><span className={`badge ${PO_STATUS_CLASS[po.status] || ''}`}>{po.status}</span></strong></div>
        <div className="report-kpi"><span>Created</span><strong style={{ fontSize: '.95rem' }}>{dateTime(po.createdAt)}</strong></div>
        {po.receivedAt && <div className="report-kpi ok"><span>Received</span><strong style={{ fontSize: '.95rem' }}>{dateTime(po.receivedAt)}</strong></div>}
      </div>
      {po.note && <p className="hint">{po.note}</p>}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th className="num">Ordered</th><th className="num">Unit cost</th><th className="num">Line total</th><th className="num">In stock now</th></tr></thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className="muted-cell">{l.sku}</td>
                <td className="num">{qtyFmt(l.qty)}</td>
                <td className="num muted-cell">{fmt(l.unitCost)}</td>
                <td className="num"><strong>{fmt(l.lineTotal)}</strong></td>
                <td className="num">{l.product?.stock != null ? qtyFmt(l.product.stock) : '–'}</td>
              </tr>
            ))}
            <tr className="sum">
              <td colSpan="4">Total</td>
              <td className="num">{fmt(po.total)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      {po.status !== 'received' && (
        <div className="actions">
          <button className="primary" onClick={onReceive}>Receive all stock</button>
        </div>
      )}
    </Modal>
  );
}
