import { useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import { download } from '../api.js';
import { cacheGet, swrFetch } from '../cache.js';
import { Field, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import { SHOP_NAME, fmt, todayStr } from '../format.js';
import { Delta, Panel, SERIES_1, SERIES_2, theme } from './ReportsOverview.jsx';

/**
 * Profit and loss: what was sold, what those goods cost, gross profit, the running costs (expenses) and what is
 * left: net profit. Compared with the period before; by day (or by month for long periods).
 */
const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const PRESETS = [
  ['month', 'This month', () => ({ from: `${todayStr().slice(0, 8)}01`, to: todayStr() })],
  ['last', 'Last month', () => {
    const first = new Date(`${todayStr().slice(0, 8)}01T00:00:00Z`);
    const end = new Date(first.getTime() - DAY);
    return { from: `${iso(end).slice(0, 8)}01`, to: iso(end) };
  }],
  ['30d', 'Last 30 days', () => ({ from: iso(Date.parse(`${todayStr()}T00:00:00Z`) - 29 * DAY), to: todayStr() })],
  ['year', 'This year', () => ({ from: `${todayStr().slice(0, 4)}-01-01`, to: todayStr() })],
];
const label = (period, monthly) => (monthly
  ? new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  : new Date(`${period}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const compact = (n) => (Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(Math.abs(n) >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));
const pctText = (v) => (v === null || v === undefined ? '' : `${v}%`);

export default function ProfitLoss() {
  const toast = useToast();
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(PRESETS[0][2]());
  const key = `/reports/profit?from=${range.from}&to=${range.to}`;
  const [d, setD] = useState(() => cacheGet(key) ?? undefined);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setD((cur) => cacheGet(key) ?? (cur?.from === range.from && cur?.to === range.to ? cur : undefined));
    swrFetch(key, { onData: setD, onRefreshing: setRefreshing, ttlMs: 60_000 }).catch((e) => { toast(e.message, 'err'); setD(null); });
  }, [key, range.from, range.to, toast]);

  const pick = (k) => { setPreset(k); setRange(PRESETS.find((p) => p[0] === k)[2]()); };
  const setFrom = (v) => { setPreset(''); setRange((r) => ({ from: v, to: v > r.to ? v : r.to })); };
  const setTo = (v) => { setPreset(''); setRange((r) => ({ from: v < r.from ? v : r.from, to: v })); };
  const csv = () => download(`${key}&format=csv`, `profit-and-loss-${range.from}-to-${range.to}.csv`).catch((e) => toast(e.message, 'err'));
  const printIt = () => {
    document.body.classList.add('print-pl');
    const done = () => { document.body.classList.remove('print-pl'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000);
  };
  const chart = useMemo(() => (d ? d.series.map((s) => ({ ...s, label: label(s.period, d.monthly) })) : []), [d]);
  const catTotal = d ? d.byCategory.reduce((t, c) => t + c.amount, 0) : 0;
  const loss = d && d.netProfit < 0;

  return (
    <ThemeProvider theme={theme}>
      <RefreshIndicator refreshing={refreshing} />
      <div className="viz-filters no-print">
        <div className="seg viz-presets" role="group" aria-label="Period">
          {PRESETS.map(([k, l]) => <button key={k} className={preset === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}
        </div>
        <div className="filters">
          <Field label="From"><input type="date" value={range.from} max={todayStr()} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={range.to} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        </div>
        {d && <div className="pl-actions"><button onClick={printIt}>Print</button><button onClick={csv}>Download CSV</button></div>}
      </div>

      {d === undefined && <TableSkeleton cols={3} rows={8} />}
      {d && (
        <div className="pl">
          <div className="report-kpis">
            <div className="report-kpi"><span>Sales</span><strong>{fmt(d.revenue)}</strong><Delta value={d.change.revenue} /></div>
            <div className="report-kpi"><span>Gross profit</span><strong>{fmt(d.grossProfit)}</strong><Delta value={d.change.grossProfit} />{d.grossMargin !== null && <small className="kpi-delta">margin {d.grossMargin}%</small>}</div>
            <div className="report-kpi"><span>Expenses</span><strong>{fmt(d.expenses)}</strong><Delta value={d.change.expenses} /></div>
            <div className={`report-kpi key${loss ? ' loss' : ''}`}><span>{loss ? 'Net loss' : 'Net profit'}</span><strong>{fmt(d.netProfit)}</strong><Delta value={d.change.netProfit} />{d.netMargin !== null && <small className="kpi-delta">margin {d.netMargin}%</small>}</div>
          </div>

          <div className="viz-grid">
            <Panel title="Profit and loss statement" sub={`${longDate(d.from)} to ${longDate(d.to)}`}>
              <div className="pl-print-head"><strong>{SHOP_NAME}</strong> · Profit and loss · {longDate(d.from)} to {longDate(d.to)}</div>
              <table className="pl-table">
                <tbody>
                  <tr><td>Sales <small>after discounts and returns</small></td><td className="num">{fmt(d.revenue)}</td></tr>
                  <tr><td>Less: cost of the goods sold</td><td className="num neg">({fmt(d.costOfGoods)})</td></tr>
                  <tr className="sub"><td>Gross profit <small>{pctText(d.grossMargin)}</small></td><td className="num">{fmt(d.grossProfit)}</td></tr>
                  <tr className="head"><td colSpan="2">Less: expenses</td></tr>
                  {d.byCategory.map((c) => <tr key={c.category} className="indent"><td>{c.category}</td><td className="num neg">({fmt(c.amount)})</td></tr>)}
                  {d.byCategory.length === 0 && <tr className="indent"><td className="muted-cell">No expenses recorded</td><td className="num">–</td></tr>}
                  <tr className="sub"><td>Total expenses</td><td className="num neg">({fmt(d.expenses)})</td></tr>
                  <tr className={`total${loss ? ' loss' : ''}`}><td>{loss ? 'Net loss' : 'Net profit'} <small>{pctText(d.netMargin)}</small></td><td className="num">{fmt(d.netProfit)}</td></tr>
                </tbody>
              </table>
              <p className="hint pl-note">Cost of goods uses each item&apos;s cost when it was sold. Expenses count on the date they were paid.</p>
            </Panel>

            <Panel title="Where the money went" sub="Expenses by kind">
              {d.byCategory.length ? (
                <ul className="dash-methods">
                  {d.byCategory.map((c) => (
                    <li key={c.category}>
                      <div><span>{c.category}</span><strong>{fmt(c.amount)}</strong></div>
                      <span className="dash-bar"><i style={{ width: `${(c.amount / catTotal) * 100}%`, background: SERIES_2 }} /></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="hint">No expenses in this period. Record rent, wages and other costs on the Expenses page to see your true profit.</p>}
            </Panel>

            <Panel title={d.monthly ? 'By month' : 'By day'} sub="Gross profit against expenses" wide>
              {chart.some((c) => c.grossProfit || c.expenses) ? (
                <BarChart
                  height={280}
                  borderRadius={4}
                  grid={{ horizontal: true }}
                  margin={{ left: 4, right: 8, top: 16, bottom: 4 }}
                  slotProps={{ tooltip: { trigger: 'axis' }, legend: { position: { vertical: 'top', horizontal: 'end' } } }}
                  xAxis={[{ scaleType: 'band', data: chart.map((c) => c.label), categoryGapRatio: 0.3, barGapRatio: 0.1, tickLabelStyle: { fontSize: 11 } }]}
                  yAxis={[{ width: 'auto', valueFormatter: (v) => compact(v) }]}
                  series={[
                    { data: chart.map((c) => c.grossProfit), label: 'Gross profit', color: SERIES_1, valueFormatter: (v) => fmt(v) },
                    { data: chart.map((c) => c.expenses), label: 'Expenses', color: SERIES_2, valueFormatter: (v) => fmt(v) },
                  ]}
                />
              ) : <p className="hint">Nothing sold or spent in this period.</p>}
              <div className="tablewrap">
                <table>
                  <thead><tr><th>{d.monthly ? 'Month' : 'Day'}</th><th className="num">Sales</th><th className="num">Gross profit</th><th className="num">Expenses</th><th className="num">Net profit</th></tr></thead>
                  <tbody>
                    {[...chart].reverse().filter((c) => c.revenue || c.expenses).map((c) => (
                      <tr key={c.period}><td>{c.label}</td><td className="num">{fmt(c.revenue)}</td><td className="num">{fmt(c.grossProfit)}</td><td className="num">{fmt(c.expenses)}</td>
                        <td className={`num${c.netProfit < 0 ? ' owes' : ''}`}><strong>{fmt(c.netProfit)}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </ThemeProvider>
  );
}
