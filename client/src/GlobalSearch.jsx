import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cacheGet } from './cache.js';
import { fmt, productLabel, qtyFmt } from './format.js';

/**
 * Top-bar search (Ctrl+K / ⌘K): jump to a page, a product or a customer. Uses the copies the app already keeps
 * in memory, so it answers instantly and works offline.
 */
export default function GlobalSearch({ pages, isOwner }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); setOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const has = (v) => v && String(v).toLowerCase().includes(t);
    const out = pages.filter((p) => has(p.label) || has(p.sub)).slice(0, 4).map((p) => ({ kind: 'Page', key: `p${p.to}`, label: p.label, hint: p.sub, go: () => navigate(p.to) }));
    const products = cacheGet('/products?all=1&q=') || cacheGet('/products') || [];
    products.filter((p) => has(productLabel(p)) || has(p.sku) || has(p.barcode)).slice(0, 6).forEach((p) => out.push({
      kind: 'Product', key: `x${p._id}`, label: productLabel(p), hint: `${fmt(p.retailPrice)} · ${qtyFmt(p.stock)} in stock`,
      go: () => navigate(isOwner ? '/products' : '/', { state: { q: p.name } }),
    }));
    const customers = cacheGet('/customers?q=') || [];
    customers.filter((c) => has(c.name) || has(c.phone)).slice(0, 4).forEach((c) => out.push({
      kind: 'Customer', key: `c${c._id}`, label: c.name, hint: [c.phone, c.balance > 0 ? `owes ${fmt(c.balance)}` : null].filter(Boolean).join(' · '),
      go: () => navigate('/customers', { state: { q: c.name } }),
    }));
    return out;
  }, [q, pages, isOwner, navigate]);

  const pick = (r) => { r.go(); setQ(''); setOpen(false); ref.current?.blur(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
  };

  return (
    <div className="gsearch">
      <Search size={16} aria-hidden="true" />
      <input ref={ref} value={q} placeholder="Search products, customers, pages" aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKeyDown} />
      <kbd>Ctrl K</kbd>
      {open && q.trim() && (
        <div className="gsearch-pop" role="listbox">
          {results.length === 0 && <div className="gsearch-empty">Nothing matches "{q}"</div>}
          {results.map((r, i) => (
            <button key={r.key} type="button" role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)} onMouseEnter={() => setActive(i)}>
              <span className="gs-kind">{r.kind}</span>
              <span className="gs-main"><strong>{r.label}</strong>{r.hint && <small>{r.hint}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
