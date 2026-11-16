import { useEffect, useState } from 'react';
import { download } from '../api.js';
import { swrFetch } from '../cache.js';
import { Field, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import { fmt, qtyFmt, todayStr } from '../format.js';
import Overview from './ReportsOverview.jsx';
import DailyReport from './DailyReport.jsx';

const TABS = [['overview', 'Overview'], ['daily', 'Daily report'], ['product', 'Sales by product'], ['stock', 'Stock list']];

export default function Reports() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="page">
      <div className="tab-bar">
        {TABS.map(([k, l]) => (
          <button key={k} className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'daily' && <DailyReport />}
      {tab === 'product' && <ByProduct />}
      {tab === 'stock' && <StockList />}
    </div>
  );
}

function ByProduct() {
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setRows(null);
    swrFetch(`/reports/by-product?from=${from}&to=${to}`, {
      onData: (r) => setRows(r.rows),
      onRefreshing: setRefreshing,
      ttlMs: 60_000,
    }).catch((e) => { toast(e.message, 'err'); setRows([]); });
  }, [from, to, toast]);

  const totalRevenue = (rows ?? []).reduce((s, r) => s + r.revenue, 0);
  const totalProfit = (rows ?? []).reduce((s, r) => s + r.profit, 0);

  return (
    <>
      <RefreshIndicator refreshing={refreshing} />
      <div className="sales-topbar" style={{ marginTop: '1rem' }}>
        <div className="filters">
          <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {rows?.length > 0 && (
          <div className="sales-summary">
            <div className="sales-stat key"><span>Revenue</span><strong>{fmt(totalRevenue)}</strong></div>
            <div className="sales-stat"><span>Profit</span><strong>{fmt(totalProfit)}</strong></div>
          </div>
        )}
      </div>
      {rows === null && <TableSkeleton cols={5} rows={8} />}
      {rows !== null && (
      <div className="tablewrap">
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th className="num">Qty sold</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product}>
                <td>{r.name}</td><td className="muted-cell">{r.sku}</td>
                <td className="num">{qtyFmt(r.qty)}</td>
                <td className="num"><strong>{fmt(r.revenue)}</strong></td>
                <td className="num">{fmt(r.profit)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="5" className="empty">No sales in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}

function StockList() {
  const toast = useToast();
  const [data, setData] = useState(undefined);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    swrFetch('/reports/stock', { onData: setData, onRefreshing: setRefreshing, ttlMs: 60_000 })
      .catch((e) => { toast(e.message, 'err'); setData(null); });
  }, [toast]);

  return (
    <>
      <RefreshIndicator refreshing={refreshing} />
      <div className="sales-topbar" style={{ marginTop: '1rem' }}>
        {data && (
          <div className="sales-summary">
            <div className="sales-stat key"><span>Total stock value</span><strong>{fmt(data.totalValue)}</strong></div>
            <div className="sales-stat"><span>Products</span><strong>{data.rows.length}</strong></div>
            <div className="sales-stat warn"><span>Low / out of stock</span><strong>{data.rows.filter((r) => r.low).length}</strong></div>
          </div>
        )}
        <button onClick={() => download('/reports/stock?format=csv', 'stock.csv').catch((e) => toast(e.message, 'err'))}>
          Download CSV
        </button>
      </div>
      {data === undefined && <TableSkeleton cols={6} rows={10} />}
      {data && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Product</th><th>SKU</th><th className="num">In stock</th><th className="num">Reorder at</th><th className="num">Cost</th><th className="num">Value</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.sku}>
                  <td>{r.name}</td>
                  <td className="muted-cell">{r.sku}</td>
                  <td className={`num${r.low ? ' owes' : ''}`}>{qtyFmt(r.stock)}</td>
                  <td className="num muted-cell">{qtyFmt(r.reorderLevel)}</td>
                  <td className="num muted-cell">{fmt(r.costPrice)}</td>
                  <td className="num"><strong>{fmt(r.value)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
