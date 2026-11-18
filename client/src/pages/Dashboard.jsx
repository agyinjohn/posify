import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import {
  AlertTriangle, ArrowRight, Banknote, Boxes, CircleDollarSign, HandCoins, Receipt, RotateCcw, ShoppingBag, TrendingUp, Undo2, X,
} from 'lucide-react';
import { cacheGet, swrFetch } from '../cache.js';
import { useAuth } from '../auth.jsx';
import { RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import { fmt, qtyFmt, todayStr } from '../format.js';
import { SERIES_1, hourLabel, theme } from './ReportsOverview.jsx';

/**
 * Owner's home page: the period's money in summary cards (compared with the period before), a sales chart,
 * how customers paid, best sellers, what is running low, who owes the shop and the latest sales.
 */

const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const back = (d, days) => iso(Date.parse(`${d}T00:00:00Z`) - days * DAY);
const PERIODS = [
  ['today', 'Today', () => ({ from: todayStr(), to: todayStr() })],
  ['7d', '7 days', () => ({ from: back(todayStr(), 6), to: todayStr() })],
  ['30d', '30 days', () => ({ from: back(todayStr(), 29), to: todayStr() })],
  ['month', 'This month', () => ({ from: `${todayStr().slice(0, 8)}01`, to: todayStr() })],
];
const keyFor = ({ from, to }) => `/reports/dashboard?from=${from}&to=${to}`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const longToday = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const time = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const compact = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(Math.abs(n) >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));
const STATUS = { completed: ['Paid', 'badge-green'], voided: ['Voided', 'badge-red'], 'partial-return': ['Part. return', 'badge-amber'] };

function Change({ value, against }) {
  if (value === null || value === undefined) return <span className="dash-change none">no earlier figures</span>;
  const up = value >= 0;
  return <span className={`dash-change ${value === 0 ? '' : up ? 'up' : 'down'}`}>{value === 0 ? '■' : up ? '▲' : '▼'} {Math.abs(value)}% <small>vs {against}</small></span>;
}

function Kpi({ tone, icon: Icon, label, value, children }) {
  return (
    <div className={`dash-kpi ${tone}`}>
      <span className="dash-kpi-icon"><Icon size={22} aria-hidden="true" /></span>
      <div className="dash-kpi-body">
        <span className="dash-kpi-label">{label}</span>
        <strong>{value}</strong>
        {children}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, tone, label, value, hint, to }) {
  return (
    <div className="dash-stat">
      <div className="dash-stat-top">
        <div><strong>{value}</strong><span>{label}</span></div>
        <span className={`dash-stat-icon ${tone}`}><Icon size={18} aria-hidden="true" /></span>
      </div>
      <div className="dash-stat-foot">
        <span>{hint}</span>
        {to && <Link to={to}>View</Link>}
      </div>
    </div>
  );
}

function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`dash-card ${className}`}>
      <header>
        <h2>{Icon && <span className="dash-card-icon"><Icon size={16} aria-hidden="true" /></span>}{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const toast = useToast();
  const { user } = useAuth();
  const [period, setPeriod] = useState('today');
  const range = useMemo(() => PERIODS.find((p) => p[0] === period)[2](), [period]);
  const [d, setD] = useState(() => cacheGet(keyFor(range)) ?? undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [hideAlert, setHideAlert] = useState(false);

  useEffect(() => {
    setD((cur) => cacheGet(keyFor(range)) ?? (cur?.from === range.from && cur?.to === range.to ? cur : undefined));
    swrFetch(keyFor(range), { onData: setD, onRefreshing: setRefreshing, ttlMs: 60_000 })
      .catch((e) => { toast(e.message, 'err'); setD(null); });
  }, [range, toast]);

  const single = range.from === range.to;
  const against = single ? (period === 'today' ? 'yesterday' : 'day before') : 'previous period';
  const chart = useMemo(() => {
    if (!d) return null;
    if (single) {
      const active = d.byHour.filter((h) => h.sales > 0).map((h) => h.hour);
      const rows = d.byHour.slice(active.length ? Math.min(...active, 7) : 7, (active.length ? Math.max(...active, 19) : 19) + 1);
      return { labels: rows.map((h) => hourLabel(h.hour)), values: rows.map((h) => h.revenue) };
    }
    return { labels: d.daily.map((x) => shortDate(x.date)), values: d.daily.map((x) => x.revenue) };
  }, [d, single]);
  const methodTotal = d ? d.byMethod.reduce((t, m) => t + Math.max(m.amount, 0), 0) : 0;
  const attention = d ? d.stock.outCount + d.stock.lowCount : 0;

  return (
    <ThemeProvider theme={theme}>
      <RefreshIndicator refreshing={refreshing} />
      <div className="dash">
        <div className="dash-hero">
          <div>
            <h2>{greeting()}, {user.name.split(' ')[0]}</h2>
            <p>{longToday()}{d && <> · <strong>{d.totals.salesCount}</strong> sale{d.totals.salesCount === 1 ? '' : 's'} {period === 'today' ? 'today' : 'in this period'}</>}</p>
          </div>
          <div className="seg dash-periods" role="group" aria-label="Period">
            {PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)} aria-pressed={period === k}>{l}</button>)}
          </div>
        </div>

        {d === undefined && <TableSkeleton cols={4} rows={6} />}
        {d && (
          <>
            {attention > 0 && !hideAlert && (
              <div className="dash-alert" role="status">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>
                  {d.stock.outCount > 0 && <><strong>{d.stock.outCount}</strong> product{d.stock.outCount === 1 ? ' is' : 's are'} out of stock</>}
                  {d.stock.outCount > 0 && d.stock.lowCount > 0 && ' and '}
                  {d.stock.lowCount > 0 && <><strong>{d.stock.lowCount}</strong> running low</>}.
                  {' '}<Link to="/stock">Restock now</Link>
                </span>
                <button className="ghost" onClick={() => setHideAlert(true)} aria-label="Dismiss"><X size={16} /></button>
              </div>
            )}

            <div className="dash-kpis">
              <Kpi tone="gold" icon={CircleDollarSign} label="Total sales" value={fmt(d.totals.revenue)}><Change value={d.change.revenue} against={against} /></Kpi>
              <Kpi tone="ink" icon={TrendingUp} label="Profit" value={fmt(d.totals.profit)}><Change value={d.change.profit} against={against} /></Kpi>
              <Kpi tone="green" icon={Receipt} label="Sales" value={d.totals.salesCount}><span className="dash-change plain">Average {fmt(d.totals.avgSale)}</span></Kpi>
              <Kpi tone="indigo" icon={HandCoins} label="Customers owe" value={fmt(d.debt.total)}><span className="dash-change plain">{d.debt.customers} customer{d.debt.customers === 1 ? '' : 's'}</span></Kpi>
            </div>

            <div className="dash-stats">
              <Stat icon={Boxes} tone="blue" label="Stock value (at cost)" value={fmt(d.stock.value)} hint={`${fmt(d.stock.retailValue)} at selling price`} to="/reports" />
              <Stat icon={ShoppingBag} tone="green" label="Items sold" value={qtyFmt(d.totals.itemsSold)} hint={`${d.productsSold} product${d.productsSold === 1 ? '' : 's'}`} to="/reports" />
              <Stat icon={Banknote} tone="gold" label="Debts collected" value={fmt(d.totals.debtCollected)} hint={`Sold on credit: ${fmt(d.totals.creditGiven)}`} to="/customers" />
              <Stat icon={Undo2} tone="red" label="Refunds" value={fmt(d.totals.refunded)} hint={`Discounts: ${fmt(d.totals.discounts)}`} to="/sales" />
            </div>

            <div className="dash-grid">
              <Card title={single ? 'Sales by hour' : 'Sales by day'} icon={TrendingUp} className="span-2"
                action={<span className="dash-card-note">{fmt(d.totals.revenue)} total</span>}>
                {chart && chart.values.some((v) => v > 0) ? (
                  <BarChart
                    height={260}
                    borderRadius={6}
                    hideLegend
                    grid={{ horizontal: true }}
                    margin={{ left: 4, right: 8, top: 12, bottom: 4 }}
                    slotProps={{ tooltip: { trigger: 'axis' } }}
                    xAxis={[{ scaleType: 'band', data: chart.labels, categoryGapRatio: 0.35, tickLabelStyle: { fontSize: 11 } }]}
                    yAxis={[{ width: 'auto', valueFormatter: (v) => compact(v) }]}
                    series={[{ data: chart.values, label: 'Sales', color: SERIES_1, valueFormatter: (v) => fmt(v) }]}
                  />
                ) : <p className="dash-empty">No sales yet in this period.</p>}
              </Card>

              <Card title="How customers paid" icon={Banknote}>
                {methodTotal > 0 ? (
                  <ul className="dash-methods">
                    {d.byMethod.map((m) => (
                      <li key={m.method}>
                        <div><span>{m.method}</span><strong>{fmt(m.amount)}</strong></div>
                        <span className="dash-bar"><i style={{ width: `${Math.max(0, (m.amount / methodTotal) * 100)}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="dash-empty">No money received yet.</p>}
                <p className="dash-foot-note">Includes debt payments, less refunds.</p>
              </Card>

              <Card title="Best sellers" icon={ShoppingBag} action={<Link className="dash-link" to="/reports">Reports <ArrowRight size={14} /></Link>}>
                {d.topProducts.length ? (
                  <ol className="dash-list">
                    {d.topProducts.slice(0, 5).map((p, i) => (
                      <li key={p.id}><span className="dash-rank">{i + 1}</span><span className="dash-name">{p.name}<small>{qtyFmt(p.qty)} sold</small></span><strong>{fmt(p.revenue)}</strong></li>
                    ))}
                  </ol>
                ) : <p className="dash-empty">Nothing sold yet.</p>}
              </Card>

              <Card title="Running low" icon={AlertTriangle} action={<Link className="dash-link" to="/stock">Stock <ArrowRight size={14} /></Link>}>
                {d.stock.low.length ? (
                  <ul className="dash-list">
                    {d.stock.low.map((p) => (
                      <li key={p.id}>
                        {p.image ? <img src={p.image} alt="" className="dash-thumb" /> : <span className="dash-thumb blank" />}
                        <span className="dash-name">{p.name}<small>{p.sku}</small></span>
                        <span className={`dash-pill ${p.stock <= 0 ? 'out' : 'low'}`}>{p.stock <= 0 ? 'Out' : `${qtyFmt(p.stock)} left`}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="dash-empty">Nothing is running low.</p>}
              </Card>

              <Card title="Who owes the most" icon={HandCoins} action={<Link className="dash-link" to="/customers">Customers <ArrowRight size={14} /></Link>}>
                {d.debt.top.length ? (
                  <ul className="dash-list">
                    {d.debt.top.map((c) => (
                      <li key={c.id}><span className="dash-avatar">{c.name.charAt(0).toUpperCase()}</span><span className="dash-name">{c.name}</span><strong className="owes">{fmt(c.balance)}</strong></li>
                    ))}
                  </ul>
                ) : <p className="dash-empty">No customer owes money.</p>}
              </Card>

              <Card title="Latest sales" icon={RotateCcw} className="span-3" action={<Link className="dash-link" to="/sales">All sales <ArrowRight size={14} /></Link>}>
                {d.recentSales.length ? (
                  <div className="tablewrap flat">
                    <table>
                      <thead><tr><th>Receipt</th><th>Time</th><th>Customer</th><th>Cashier</th><th>Paid by</th><th className="num">Total</th><th>Status</th></tr></thead>
                      <tbody>
                        {d.recentSales.slice(0, 8).map((s) => (
                          <tr key={s.id}>
                            <td><strong>{s.receiptNo}</strong></td>
                            <td className="muted-cell">{iso(s.at) === todayStr() ? time(s.at) : `${shortDate(iso(s.at))}, ${time(s.at)}`}</td>
                            <td>{s.customer || <span className="muted-cell">Walk-in</span>}</td>
                            <td>{s.cashier}</td>
                            <td>{s.methods.join(', ') || <span className="muted-cell">Credit</span>}{s.owed > 0 && <span className="owes"> · owes {fmt(s.owed)}</span>}</td>
                            <td className="num"><strong>{fmt(s.total)}</strong></td>
                            <td><span className={`badge ${STATUS[s.status]?.[1] || ''}`}>{STATUS[s.status]?.[0] || s.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="dash-empty">No sales yet. <Link to="/">Make the first sale</Link></p>}
              </Card>
            </div>
          </>
        )}
      </div>
    </ThemeProvider>
  );
}
