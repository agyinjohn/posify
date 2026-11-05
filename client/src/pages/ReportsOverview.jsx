import { useEffect, useMemo, useState } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { cacheGet, swrFetch } from '../cache.js';
import { Field, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import { fmt, qtyFmt, todayStr } from '../format.js';

// Validated categorical slots (dataviz reference palette, light surface): slot 1 blue, slot 2 orange.
// One-series charts use slot 1 only; revenue and profit (same unit, one axis) use slots 1 and 2.
export const SERIES_1 = '#2a78d6';
export const SERIES_2 = '#eb6834';
export const UNIT = { pieces: { label: 'Single pieces (retail)', color: SERIES_1 }, packs: { label: 'Full packs (wholesale)', color: SERIES_2 } };
export const theme = createTheme({ typography: { fontFamily: "'Public Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" } });

const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const shift = (d, days) => iso(Date.parse(`${d}T00:00:00Z`) + days * DAY);
const monthStart = (d) => `${d.slice(0, 8)}01`;
const PRESETS = [
  ['7d', 'Last 7 days', () => ({ from: shift(todayStr(), -6), to: todayStr() })],
  ['30d', 'Last 30 days', () => ({ from: shift(todayStr(), -29), to: todayStr() })],
  ['month', 'This month', () => ({ from: monthStart(todayStr()), to: todayStr() })],
  ['last', 'Last month', () => { const end = shift(monthStart(todayStr()), -1); return { from: monthStart(end), to: end }; }],
  ['90d', 'Last 90 days', () => ({ from: shift(todayStr(), -89), to: todayStr() })],
];
export const defaultOverviewKey = () => { const r = PRESETS[0][2](); return `/reports/overview?from=${r.from}&to=${r.to}`; };

const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
};
const money = (v) => (v == null ? '' : fmt(v));
const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const hourLabel = (h) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);
const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const clip = (s, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function Delta({ value }) {
  if (value === null || value === undefined) return <small className="kpi-delta">no earlier data</small>;
  const up = value > 0;
  const same = value === 0;
  return (
    <small className={`kpi-delta ${same ? '' : up ? 'up' : 'down'}`}>
      <span aria-hidden="true">{same ? '■' : up ? '▲' : '▼'}</span> {same ? 'same as before' : `${Math.abs(value)}% ${up ? 'up' : 'down'}`}<span className="sr-only"> on the previous period</span>
    </small>
  );
}

export function Panel({ title, sub, children, wide }) {
  return (
    <section className={`viz-panel${wide ? ' wide' : ''}`}>
      <header><h3>{title}</h3>{sub && <p>{sub}</p>}</header>
      {children}
    </section>
  );
}

// Ranked horizontal bars, one hue (slot 1): names on the left, biggest first.
function RankedBars({ rows, value = 'revenue', label = 'Revenue', height }) {
  if (!rows.length) return <p className="hint">Nothing in this period.</p>;
  const h = height ?? Math.max(140, rows.length * 34 + 40);
  return (
    <BarChart
      slotProps={{ tooltip: { trigger: 'axis' } }} // hover anywhere along a bar's row or column, not just on the bar
      height={h}
      layout="horizontal"
      borderRadius={4}
      hideLegend
      grid={{ vertical: true }}
      margin={{ left: 4, right: 16, top: 8, bottom: 8 }}
      yAxis={[{ scaleType: 'band', data: rows.map((r) => r.name), width: 'auto', valueFormatter: (v, ctx) => (ctx.location === 'tick' ? clip(v) : v), categoryGapRatio: 0.35 }]}
      xAxis={[{ tickNumber: 4, valueFormatter: (v, ctx) => (ctx.location === 'tick' ? compact(v) : fmt(v)) }]}
      series={[{ data: rows.map((r) => r[value]), label, color: SERIES_1, valueFormatter: money }]}
    />
  );
}

export default function Overview() {
  const toast = useToast();
  const [preset, setPreset] = useState('7d');
  const [range, setRange] = useState(() => PRESETS[0][2]());
  const key = `/reports/overview?from=${range.from}&to=${range.to}`;
  const [d, setD] = useState(() => cacheGet(key) ?? undefined);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setD((cur) => cacheGet(key) ?? (cur && cur.from === range.from && cur.to === range.to ? cur : undefined));
    swrFetch(key, { onData: setD, onRefreshing: setRefreshing, ttlMs: 60_000 }).catch((e) => { toast(e.message, 'err'); setD(null); });
  }, [key, range.from, range.to, toast]);

  const pick = (k) => { setPreset(k); setRange(PRESETS.find((p) => p[0] === k)[2]()); };
  const setFrom = (from) => { setPreset('custom'); setRange((r) => ({ from, to: from > r.to ? from : r.to })); };
  const setTo = (to) => { setPreset('custom'); setRange((r) => ({ from: to < r.from ? to : r.from, to })); };

  const days = d?.daily?.length ?? 0;
  const hours = useMemo(() => {
    if (!d) return [];
    const active = d.byHour.filter((h) => h.sales > 0).map((h) => h.hour);
    const lo = active.length ? Math.min(...active, 7) : 7;
    const hi = active.length ? Math.max(...active, 19) : 19;
    return d.byHour.slice(lo, hi + 1);
  }, [d]);
  const unitTotal = d?.byUnit ? d.byUnit.reduce((t, u) => t + u.revenue, 0) : 0;

  return (
    <ThemeProvider theme={theme}>
      <RefreshIndicator refreshing={refreshing} />
      <div className="viz-filters">
        <div className="seg viz-presets" role="group" aria-label="Period">
          {PRESETS.map(([k, l]) => <button key={k} className={preset === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}
        </div>
        <div className="filters">
          <Field label="From"><input type="date" value={range.from} max={todayStr()} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={range.to} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        </div>
      </div>

      {d === undefined && <TableSkeleton cols={4} rows={6} />}
      {d && (
        <>
          <p className="hint viz-compare">▲▼ compare with {shortDate(d.previousRange.from)} – {shortDate(d.previousRange.to)} ({days} day{days !== 1 ? 's' : ''} before).</p>
          <div className="report-kpis">
            <div className="report-kpi key"><span>Revenue</span><strong>{fmt(d.totals.revenue)}</strong><Delta value={d.change.revenue} /></div>
            <div className="report-kpi"><span>Profit</span><strong>{fmt(d.totals.profit)}</strong><Delta value={d.change.profit} />{d.totals.margin !== null && <small className="kpi-delta">margin {d.totals.margin}%</small>}</div>
            <div className="report-kpi"><span>Sales</span><strong>{d.totals.salesCount}</strong><Delta value={d.change.salesCount} /></div>
            <div className="report-kpi"><span>Average sale</span><strong>{fmt(d.totals.avgSale)}</strong><Delta value={d.change.avgSale} /></div>
            <div className="report-kpi"><span>Items sold</span><strong>{qtyFmt(d.totals.itemsSold)}</strong><small className="kpi-delta">{d.productsSold} different products</small></div>
            <div className="report-kpi"><span>Sold on credit</span><strong>{fmt(d.totals.creditGiven)}</strong><small className="kpi-delta">collected {fmt(d.totals.debtCollected)}</small></div>
            <div className="report-kpi"><span>Discounts given</span><strong>{fmt(d.totals.discounts)}</strong>{d.totals.refunded > 0 && <small className="kpi-delta">refunded {fmt(d.totals.refunded)}</small>}</div>
          </div>

          <div className="viz-grid">
            {days > 1 && (
              <Panel title="Revenue and profit by day" sub="Net of returns. Hover a day for the figures." wide>
                <LineChart
                  height={280}
                  grid={{ horizontal: true }}
                  margin={{ left: 4, right: 28, top: 16, bottom: 8 }} // room for the last date label
                  xAxis={[{ scaleType: 'point', data: d.daily.map((x) => x.date), valueFormatter: (v) => shortDate(v), tickLabelInterval: 'auto' }]}
                  yAxis={[{ width: 'auto', tickNumber: 5, valueFormatter: (v, ctx) => (ctx.location === 'tick' ? compact(v) : fmt(v)) }]}
                  series={[
                    { data: d.daily.map((x) => x.revenue), label: 'Revenue', color: SERIES_1, curve: 'linear', showMark: days <= 31, valueFormatter: money },
                    { data: d.daily.map((x) => x.profit), label: 'Profit', color: SERIES_2, curve: 'linear', showMark: days <= 31, valueFormatter: money },
                  ]}
                />
              </Panel>
            )}

            <Panel title="Busiest hours" sub="Number of sales by the hour they were made">
              <BarChart
      slotProps={{ tooltip: { trigger: 'axis' } }} // hover anywhere along a bar's row or column, not just on the bar
                height={240}
                borderRadius={4}
                hideLegend
                grid={{ horizontal: true }}
                margin={{ left: 4, right: 8, top: 16, bottom: 8 }}
                xAxis={[{ scaleType: 'band', data: hours.map((h) => hourLabel(h.hour)), categoryGapRatio: 0.3 }]}
                yAxis={[{ width: 'auto', tickMinStep: 1 }]}
                series={[{ data: hours.map((h) => h.sales), label: 'Sales', color: SERIES_1 }]}
              />
            </Panel>

            {days >= 7 && (
              <Panel title="Revenue by day of the week">
                <BarChart
      slotProps={{ tooltip: { trigger: 'axis' } }} // hover anywhere along a bar's row or column, not just on the bar
                  height={240}
                  borderRadius={4}
                  hideLegend
                  grid={{ horizontal: true }}
                  margin={{ left: 4, right: 8, top: 16, bottom: 8 }}
                  xAxis={[{ scaleType: 'band', data: WEEK.map((w) => w[1]), categoryGapRatio: 0.3 }]}
                  yAxis={[{ width: 'auto', tickNumber: 5, valueFormatter: (v, ctx) => (ctx.location === 'tick' ? compact(v) : fmt(v)) }]}
                  series={[{ data: WEEK.map(([i]) => d.byWeekday[i].revenue), label: 'Revenue', color: SERIES_1, valueFormatter: money }]}
                />
              </Panel>
            )}

            <Panel title="Money received by method" sub="Sales and debt payments, less refunds">
              <RankedBars rows={d.byMethod.filter((m) => m.amount !== 0).map((m) => ({ name: m.method, revenue: m.amount }))} label="Received" />
            </Panel>

            <Panel title="Best sellers" sub="Top 10 products by revenue" wide>
              <RankedBars rows={d.topProducts} />
              {d.topProducts.length > 0 && (
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                    <tbody>
                      {d.topProducts.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}<br /><small className="muted-cell">{p.sku}</small></td>
                          <td className="num">{qtyFmt(p.qty)}</td>
                          <td className="num"><strong>{fmt(p.revenue)}</strong></td>
                          <td className="num">{fmt(p.profit)}</td>
                          <td className="num">{p.margin === null ? '–' : `${p.margin}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Most profitable products" sub="Top 10 by profit">
              <RankedBars rows={d.topProfit.filter((p) => p.profit > 0)} value="profit" label="Profit" />
            </Panel>

            <Panel title="Revenue by category">
              <RankedBars rows={d.categories} />
            </Panel>

            <Panel title="Single pieces and full packs" sub="Pieces sell at the retail price, full packs at the wholesale price">
              {unitTotal > 0 ? (
                <>
                  <div className="seg-bar" role="img" aria-label={d.byUnit.map((u) => `${UNIT[u.unit].label} ${fmt(u.revenue)}`).join(', ')}>
                    {d.byUnit.filter((u) => u.revenue > 0).map((u) => (
                      <div key={u.unit} style={{ flexGrow: u.revenue, background: UNIT[u.unit].color }}>
                        {u.revenue / unitTotal >= 0.12 && <span>{Math.round((u.revenue / unitTotal) * 100)}%</span>}
                      </div>
                    ))}
                  </div>
                  <ul className="seg-legend">
                    {d.byUnit.filter((u) => u.revenue > 0).map((u) => (
                      <li key={u.unit}><i style={{ background: UNIT[u.unit].color }} /> {UNIT[u.unit].label} <strong>{fmt(u.revenue)}</strong> <small>{qtyFmt(u.qty)} {u.unit === 'packs' ? 'packs' : 'pieces'}</small></li>
                    ))}
                  </ul>
                </>
              ) : <p className="hint">Nothing in this period.</p>}
            </Panel>

            <Panel title="Sales by cashier">
              {d.cashiers.length ? (
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Cashier</th><th className="num">Sales</th><th className="num">Revenue</th><th className="num">Average</th></tr></thead>
                    <tbody>
                      {d.cashiers.map((c) => (
                        <tr key={c.name}><td>{c.name}</td><td className="num">{c.sales}</td><td className="num"><strong>{fmt(c.revenue)}</strong></td><td className="num">{fmt(c.sales ? c.revenue / c.sales : 0)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="hint">Nothing in this period.</p>}
            </Panel>

            <Panel title="Stock that did not sell" sub={d.idleStock.count ? `${d.idleStock.count} product${d.idleStock.count !== 1 ? 's' : ''} in stock with no sales in this period · ${fmt(d.idleStock.value)} tied up at cost` : 'Everything in stock sold at least once'} wide>
              {d.idleStock.top.length > 0 && (
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Value at cost</th></tr></thead>
                    <tbody>
                      {d.idleStock.top.map((p) => (
                        <tr key={p.id}><td>{p.name}<br /><small className="muted-cell">{p.sku}</small></td><td className="num">{qtyFmt(p.stock)}</td><td className="num"><strong>{fmt(p.value)}</strong></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </ThemeProvider>
  );
}
