import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../ui.jsx';
import { dateTime, fmt } from '../format.js';
import { OpenShiftModal, CloseShiftModal } from './ShiftModals.jsx';

export default function Shifts() {
  const toast = useToast();
  const [shifts, setShifts] = useState([]);
  const [current, setCurrent] = useState(undefined); // undefined = loading, null = none open
  const [dialog, setDialog] = useState(null); // 'open' | 'close'

  const load = useCallback(() => {
    api('/shifts').then(setShifts).catch((e) => toast(e.message, 'err'));
    api('/shifts/current').then(setCurrent).catch(() => setCurrent(null));
  }, [toast]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <h1>Shifts</h1>
      <div className="card shift-now">
        {current === undefined && <span className="hint">Checking the current shift…</span>}
        {current === null && (
          <>
            <div><strong>No shift is open</strong><small>Open one before the first sale so cash-up matches the drawer.</small></div>
            <button className="primary" onClick={() => setDialog('open')}>Open shift</button>
          </>
        )}
        {current && (
          <>
            <div><strong>Shift open</strong><small>Since {dateTime(current.createdAt)} · {current.openedBy?.name ?? current.openedByName} · float {fmt(current.openingFloat)}</small></div>
            <button onClick={() => setDialog('close')}>Close shift</button>
          </>
        )}
      </div>
      {dialog === 'open' && <OpenShiftModal onClose={() => setDialog(null)} onOpened={() => { setDialog(null); load(); }} />}
      {dialog === 'close' && current && <CloseShiftModal shift={current} onClose={() => setDialog(null)} onClosed={() => { setDialog(null); load(); }} />}
      <div className="tablewrap"><table>
        <thead>
          <tr>
            <th>Opened</th><th>By</th><th className="num">Float</th>
            <th>Closed</th><th>By</th><th className="num">Closing cash</th>
            <th className="num">Variance</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => {
            // Real variance (count vs float + cash taken - refunds), stored when the shift closed.
            // Shifts closed before that was stored show a dash rather than a wrong number.
            const variance = s.cashVariance ?? null;
            return (
              <tr key={s._id} className={s.status === 'open' ? 'ok' : ''}>
                <td>{dateTime(s.createdAt)}</td>
                <td>{s.openedBy?.name ?? s.openedByName}</td>
                <td className="num">{fmt(s.openingFloat)}</td>
                <td>{s.closedAt ? dateTime(s.closedAt) : '—'}</td>
                <td>{s.closedByName ?? '—'}</td>
                <td className="num">{s.closingCash != null ? fmt(s.closingCash) : '—'}</td>
                <td className={`num${variance != null && variance < 0 ? ' owes' : ''}`}>
                  {variance != null ? fmt(variance) : '—'}
                </td>
                <td>{s.status}</td>
              </tr>
            );
          })}
          {shifts.length === 0 && <tr><td colSpan="8" className="empty">No shifts recorded yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
