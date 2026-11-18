import { useEffect, useState } from 'react';
import { api } from './api.js';
import { cacheInvalidatePrefix } from './cache.js';
import { Field, Modal, useToast } from './ui.jsx';
import { SHOP_NAME } from './format.js';

/**
 * Owner: load demo products, customers and six weeks of sales. An empty shop loads straight away; replacing data
 * is only offered in the demo shop and needs the shop's name typed in.
 */
export default function DemoDataModal({ onClose, onDone }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { api('/demo').then(setStatus).catch((e) => { toast(e.message, 'err'); onClose(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setBusy(true);
    try {
      const r = await api('/demo/seed', { method: 'POST', body: status.empty ? {} : { replace: true, confirm: typed } });
      ['/products', '/customers', '/sales', '/reports', '/suppliers', '/stock', '/shifts', '/audit'].forEach(cacheInvalidatePrefix);
      setDone(r); onDone?.();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  if (done) {
    return (
      <Modal title="Demo data loaded" onClose={() => window.location.reload()}>
        <p>Added {done.products} products, {done.customers} customers, {done.suppliers} suppliers and {done.sales} sales over the last six weeks.</p>
        <div className="actions"><button className="primary" onClick={() => window.location.reload()}>Show me</button></div>
      </Modal>
    );
  }
  const matches = typed.trim().toLowerCase() === SHOP_NAME.trim().toLowerCase();
  return (
    <Modal title="Demo data" onClose={onClose}>
      {!status ? <p className="hint">Checking your shop…</p> : status.empty ? (
        <>
          <p>Fill this shop with sample products, customers and six weeks of sales, so you can try every screen.</p>
          <p className="hint">Takes a few seconds. You can delete it later from the admin page (Clear sales) and by hiding the products.</p>
          <div className="actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Load demo data'}</button>
          </div>
        </>
      ) : status.canReplace ? (
        <>
          <p>This shop already has {status.products} products and {status.sales} sales. Loading the demo <strong>deletes them</strong> (with its customers and suppliers) and puts fresh demo data in their place.</p>
          <Field label={<>Type <strong>{SHOP_NAME}</strong> to confirm</>}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
          <div className="actions">
            <button onClick={onClose}>Cancel</button>
            <button className="danger" onClick={load} disabled={busy || !matches}>{busy ? 'Loading…' : 'Replace with demo data'}</button>
          </div>
        </>
      ) : (
        <>
          <p>Demo data can only be added to an empty shop. This shop already has {status.products} products and {status.sales} sales, so nothing will be changed.</p>
          <div className="actions"><button className="primary" onClick={onClose}>OK</button></div>
        </>
      )}
    </Modal>
  );
}
