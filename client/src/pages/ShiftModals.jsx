import { useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { fmt } from '../format.js';

export function OpenShiftModal({ onClose, onOpened }) {
  const toast = useToast();
  const [float, setFloat] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const shift = await api('/shifts/open', { method: 'POST', body: { openingFloat: Number(float) || 0, note } });
      toast('Shift opened'); onOpened(shift);
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title="Open shift" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Opening float (cash in drawer, GH₵)">
          <input type="number" min="0" step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Morning shift" />
        </Field>
        <div className="actions"><button className="primary" disabled={busy}>Open shift</button></div>
      </form>
    </Modal>
  );
}

export function CloseShiftModal({ shift, onClose, onClosed }) {
  const toast = useToast();
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const res = await api(`/shifts/${shift._id}/close`, { method: 'POST', body: { closingCash: Number(cash) || 0, note } });
      setSummary(res.summary);
      toast('Shift closed');
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  if (summary) {
    return (
      <Modal title="Shift closed — summary" onClose={onClosed}>
        <div className="stats">
          <div><span>Sales</span><strong>{summary.salesCount}</strong></div>
          <div className="key"><span>Total sold</span><strong>{fmt(summary.total)}</strong></div>
          <div><span>Discounts</span><strong>{fmt(summary.discounts)}</strong></div>
          <div><span>Sold on credit</span><strong>{fmt(summary.creditGiven)}</strong></div>
          <div><span>Debts collected</span><strong>{fmt(summary.debtCollected)}</strong></div>
          {summary.refunded > 0 && <div><span>Refunded</span><strong>{fmt(summary.refunded)}</strong></div>}
        </div>
        <h3>By payment method</h3>
        <div className="tablewrap narrow"><table><tbody>
          {Object.entries(summary.byMethod).map(([m, v]) => (
            <tr key={m}><td>{m}</td><td className="num">{fmt(v)}</td></tr>
          ))}
        </tbody></table></div>
        <div className="stats">
          <div><span>Expected cash</span><strong>{fmt(summary.expectedCash)}</strong></div>
          <div className={summary.cashVariance < 0 ? 'key owes' : 'key'}>
            <span>Cash variance</span><strong>{fmt(summary.cashVariance)}</strong>
          </div>
        </div>
        <div className="actions"><button className="primary" onClick={onClosed}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title="Close shift" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Cash in drawer now (GH₵)" hint="Count the physical cash and enter the total">
          <input type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} required />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. End of day" />
        </Field>
        <div className="actions"><button className="primary" disabled={busy}>Close shift &amp; see summary</button></div>
      </form>
    </Modal>
  );
}
