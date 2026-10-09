import { useEffect, useState } from 'react';
import { api, download } from '../api.js';
import { Field, useToast } from '../ui.jsx';
import { fmt, qtyFmt, todayStr } from '../format.js';

export default function Reports() {
  const [tab, setTab] = useState('daily');
  return (
    <div className="page">
      <h1>Reports</h1>
      <div className="seg" role="tablist">
        {[['daily', 'Daily summary'], ['product', 'Sales by product'], ['stock', 'Stock list']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'daily' && <Daily />}
      {tab === 'product' && <ByProduct />}
      {tab === 'stock' && <StockList />}
    </div>
  );
}

function Daily() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [d, setD] = useState(null);
  useEffect(() => { api(`/reports/daily?date=${date}`).then(setD).catch((e) => toast(e.message, 'err')); }, [date, toast]);
  return (
    <>
      <div className="filters"><Field label="Day"><input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} /></Field></div>
      {d && (
        <>
          <div className="stats">
            <div><span>Sales</span><strong>{d.salesCount}</strong></div>
            <div className="key"><span>Total sold</span><strong>{fmt(d.total)}</strong></div>
            <div><span>Profit</span><strong>{fmt(d.profit)}</strong></div>
            <div><span>Discounts given</span><strong>{fmt(d.discounts)}</strong></div>
            <div><span>Sold on credit</span><strong>{fmt(d.creditGiven)}</strong></div>
            <div><span>Debts collected</span><strong>{fmt(d.debtCollected)}</strong></div>
          </div>
          <h2>Money received by payment method</h2>
          <div className="tablewrap narrow"><table>
            <tbody>
              {Object.entries(d.byMethod).map(([m, v]) => <tr key={m}><td>{m}</td><td className="num">{fmt(v)}</td></tr>)}
              <tr className="sum"><td>Total received</td><td className="num">{fmt(Object.values(d.byMethod).reduce((s, v) => s + v, 0))}</td></tr>
            </tbody>
          </table></div>
          {d.voidedCount > 0 && <p className="hint">{d.voidedCount} voided sale{d.voidedCount > 1 ? 's' : ''} ({fmt(d.voidedTotal)}) are not counted above.</p>}
        </>
      )}
    </>
  );
}

function ByProduct() {
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [rows, setRows] = useState([]);
  useEffect(() => { api(`/reports/by-product?from=${from}&to=${to}`).then((r) => setRows(r.rows)).catch((e) => toast(e.message, 'err')); }, [from, to, toast]);
  return (
    <>
      <div className="filters">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Product</th><th>SKU</th><th className="num">Qty sold</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.product}><td>{r.name}</td><td>{r.sku}</td><td className="num">{qtyFmt(r.qty)}</td><td className="num">{fmt(r.revenue)}</td><td className="num">{fmt(r.profit)}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan="5" className="empty">No sales in this period.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function StockList() {
  const toast = useToast();
  const [data, setData] = useState(null);
  useEffect(() => { api('/reports/stock').then(setData).catch((e) => toast(e.message, 'err')); }, [toast]);
  return (
    <>
      <div className="filters">
        {data && <p className="hint">Stock value at cost: <strong>{fmt(data.totalValue)}</strong></p>}
        <button onClick={() => download('/reports/stock?format=csv', 'stock.csv').catch((e) => toast(e.message, 'err'))}>Download CSV for Excel</button>
      </div>
      {data && (
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th>SKU</th><th className="num">In stock</th><th className="num">Reorder at</th><th className="num">Cost</th><th className="num">Value</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.sku}><td>{r.name}</td><td>{r.sku}</td><td className={`num${r.low ? ' owes' : ''}`}>{qtyFmt(r.stock)}</td>
                <td className="num">{qtyFmt(r.reorderLevel)}</td><td className="num">{fmt(r.costPrice)}</td><td className="num">{fmt(r.value)}</td></tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
