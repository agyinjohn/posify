import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../ui.jsx';
import { dateTime, fmt } from '../format.js';

export default function Shifts() {
  const toast = useToast();
  const [shifts, setShifts] = useState([]);

  const load = useCallback(() => {
    api('/shifts').then(setShifts).catch((e) => toast(e.message, 'err'));
  }, [toast]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <h1>Shifts</h1>
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
            const variance = s.closingCash != null
              ? Math.round((s.closingCash - s.openingFloat) * 100) / 100
              : null;
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
