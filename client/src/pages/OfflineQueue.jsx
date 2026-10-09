import { dateTime, fmt } from '../format.js';
import { useOfflineSync } from '../offlineSync.js';
import { Modal } from '../ui.jsx';

/**
 * Floating badge shown in the nav when there are queued sales.
 * Clicking it opens the full queue panel.
 */
export function QueueBadge({ onClick }) {
  const { online, queue, syncing } = useOfflineSync();
  const pending = queue.filter((q) => q.status === 'pending').length;
  const failed = queue.filter((q) => q.status === 'error').length;

  if (queue.length === 0 && online) return null;

  return (
    <button
      className={`queue-badge${failed > 0 ? ' err' : ''}`}
      onClick={onClick}
      title="Offline sale queue"
    >
      {!online && <span className="dot offline" />}
      {syncing ? 'Syncing…' : failed > 0 ? `${failed} failed` : `${pending} queued`}
    </button>
  );
}

/**
 * Full queue panel modal.
 */
export function QueuePanel({ onClose }) {
  const { online, queue, syncing, sync, retry, discard } = useOfflineSync();
  const pending = queue.filter((q) => q.status === 'pending');
  const failed = queue.filter((q) => q.status === 'error');

  return (
    <Modal title="Offline sale queue" onClose={onClose}>
      <div className="stats">
        <div>
          <span>Connection</span>
          <strong className={online ? '' : 'owes'}>{online ? 'Online' : 'Offline'}</strong>
        </div>
        <div><span>Pending</span><strong>{pending.length}</strong></div>
        <div className={failed.length > 0 ? 'key owes' : 'key'}>
          <span>Failed</span><strong>{failed.length}</strong>
        </div>
      </div>

      {queue.length === 0 && (
        <p className="hint">No queued sales. All sales have been synced.</p>
      )}

      {pending.length > 0 && (
        <>
          <h3>Pending</h3>
          <div className="tablewrap"><table>
            <thead><tr><th>Queued at</th><th>Receipt</th><th className="num">Items</th></tr></thead>
            <tbody>
              {pending.map((item) => (
                <tr key={item.id}>
                  <td>{dateTime(item.queuedAt)}</td>
                  <td>OFFLINE-{item.id}</td>
                  <td className="num">{item.payload?.items?.length ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {failed.length > 0 && (
        <>
          <h3>Failed</h3>
          <div className="tablewrap"><table>
            <thead><tr><th>Queued at</th><th>Receipt</th><th>Error</th><th></th></tr></thead>
            <tbody>
              {failed.map((item) => (
                <tr key={item.id} className="voided">
                  <td>{dateTime(item.queuedAt)}</td>
                  <td>OFFLINE-{item.id}</td>
                  <td><small>{item.error}</small></td>
                  <td className="acts">
                    <button onClick={() => retry(item.id)}>Retry</button>
                    <button className="danger" onClick={() => discard(item.id)}>Discard</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="hint">
            A failed sale will <strong>not</strong> be retried automatically.
            If the error is a stock or data problem, discard it.
            If it was a temporary server error, retry it.
          </p>
        </>
      )}

      <div className="actions">
        {online && queue.length > 0 && (
          <button className="primary" disabled={syncing} onClick={sync}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
