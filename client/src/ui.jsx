import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,select,textarea,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header><h2>{title}</h2><button className="ghost" onClick={onClose} aria-label="Close">Close</button></header>
        {children}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setItems((s) => [...s, { id, message, kind }]);
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

export function Spinner({ size = 20 }) {
  return (
    <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />
  );
}

// Subtle top-right indicator shown during background refreshes (data already visible).
export function RefreshIndicator({ refreshing }) {
  if (!refreshing) return null;
  return (
    <div className="refresh-indicator" role="status" aria-label="Refreshing">
      <Spinner size={14} />
    </div>
  );
}

// Skeleton rows for tables — shows while data is loading.
export function TableSkeleton({ cols = 4, rows = 6 }) {
  return (
    <div className="tablewrap">
      <table>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}><span className="skel" style={{ width: `${55 + ((r * 3 + c * 7) % 35)}%` }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Skeleton grid for card layouts (Products, Users, Suppliers).
export function CardSkeleton({ count = 8 }) {
  return (
    <div className="skel-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel-card">
          <div className="skel skel-img" />
          <div className="skel" style={{ width: '70%', marginTop: '.6rem' }} />
          <div className="skel" style={{ width: '45%', marginTop: '.35rem' }} />
          <div className="skel" style={{ width: '55%', marginTop: '.35rem' }} />
        </div>
      ))}
    </div>
  );
}
