import { useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import { api, download } from '../api.js';
import { cacheGet, swrFetch } from '../cache.js';
import { Field, Modal, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import Receipt from '../Receipt.jsx';
import { fmt, qtyFmt, todayStr, SHOP_NAME } from '../format.js';
import { Delta, Panel, SERIES_1, UNIT, hourLabel, theme } from './ReportsOverview.jsx';

/**
 * Daily sales report: one day in full, compared with the day before.
 * Headline figures, sales through the day, money by payment method and the cash the drawer should hold,
 * every product sold (packs and loose pieces), every sale with its receipt, refunds, debt payments and cashiers.
 * Prints on A4 (Print report) and downloads as two spreadsheets.
 */

const DAY = 86_400_000;
const shift = (d, days) => new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const time = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }); // UTC = Ghana time
const STATUS = { completed: ['Completed', 'badge-green'], voided: ['Voided', 'badge-red'], 'partial-return': ['Part. return', 'badge-amber'] };
const SHOW_SALES = 50;

export const dailyReportKey = (date = todayStr()) => `/reports/daily-sales?date=${date}`;

// "2 ctn + 3 pcs", "5 pcs", "1 box"
export function soldLabel(r) {
  const parts = [];
  if (r.packs > 0) parts.push(`${qtyFmt(r.packs)} ${r.packLabel || 'pack'}`);
  if (r.pieces > 0 || parts.length === 0) parts.push(`${qtyFmt(r.pieces)} pc${r.pieces === 1 ? '' : 's'}`);
  return parts.join(' + ');
}

export default function DailyReport() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [d, setD] = useState(() => cacheGet(dailyReportKey()) ?? undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [allSales, setAllSales] = useState(false);
  const [view, setView] = useState(null);

  useEffect(() => {
    setAllSales(false);
    setD((cur) => cacheGet(dailyReportKey(date)) ?? (cur?.date === date ? cur : undefined));
    swrFetch(dailyReportKey(date), { onData: setD, onRefreshing: setRefreshing, ttlMs: 60_000 })
      .catch((e) => { toast(e.message, 'err'); setD(null); });
  }, [date, toast]);

  // Trim the hour chart to the shop's working day (7am–7pm), widened when sales happened outside it.
  const hours = useMemo(() => {
    if (!d) return [];
    const active = d.byHour.filter((h) => h.sales > 0).map((h) => h.hour);
    return d.byHour.slice(active.length ? Math.min(...active, 7) : 7, (active.length ? Math.max(...active, 19) : 19) + 1);
  }, [d]);

  const openReceipt = async (id) => {
    try { setView(await api(`/sales/${id}`)); } catch (e) { toast(e.message, 'err'); }
  };
  const printReport = () => {
    document.body.classList.add('print-report');
    const done = () => { document.body.classList.remove('print-report'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000); // browsers that don't fire afterprint
  };
  const csv = (part) => download(`/reports/daily-sales?date=${date}&format=csv&part=${part}`, `${part}-${date}.csv`).catch((e) => toast(e.message, 'err'));

  const today = todayStr();
  const unitTotal = d ? d.byUnit.reduce((t, u) => t + u.revenue, 0) : 0;
  const busiest = d ? d.byHour.reduce((b, h) => (h.sales > (b?.sales ?? 0) ? h : b), null) : null;
  const salesShown = d ? (allSales ? d.sales : d.sales.slice(0, SHOW_SALES)) : [];

  return (
    <ThemeProvider theme={theme}>
      <RefreshIndicator refreshing={refreshing} />
      <div className="daily-toolbar no-print">
        <div className="daily-date">
          <button aria-label="Previous day" onClick={() => setDate(shift(date, -1))}>‹</button>
          <Field label="Day"><input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
          <button aria-label="Next day" onClick={() => setDate(shift(date, 1))} disabled={date >= today}>›</button>
          {date !== today && <button className="ghost" onClick={() => setDate(today)}>Today</button>}
        </div>
        {d && (
          <div className="daily-actions">
            <button onClick={printReport}>Print report</button>
            <button onClick={() => csv('sales')}>Sales CSV</button>
            <button onClick={() => csv('items')}>Items CSV</button>
          </div>
        )}
      </div>

      {d === undefined && <TableSkeleton cols={4} rows={6} />}
      {d && (
        <div className="daily-report">
          <div className="daily-head">
            <h2>{SHOP_NAME} — daily sales report</h2>
            <p>{longDate(d.date)}{date === today ? ' (so far today)' : ''} · ▲▼ compared with {shortDate(d.previousDate)}</p>
          </div>

          <div className="report-kpis">
            <div className="report-kpi key"><span>Total sold</span><strong>{fmt(d.totals.revenue)}</strong><Delta value={d.change.revenue} /></div>
            <div className="report-kpi"><span>Profit</span><strong>{fmt(d.totals.profit)}</strong><Delta value={d.change.profit} />{d.totals.margin !== null && <small className="kpi-delta">margin {d.totals.margin}%</small>}</div>
            <div className="report-kpi"><span>Sales</span><strong>{d.totals.salesCount}</strong><Delta value={d.change.salesCount} /></div>
            <div className="report-kpi"><span>Average sale</span><strong>{fmt(d.totals.avgSale)}</strong><Delta value={d.change.avgSale} /></div>
            <div className="report-kpi"><span>Items sold (pieces)</span><strong>{qtyFmt(d.totals.itemsSold)}</strong><small className="kpi-delta">{d.items.length} product{d.items.length === 1 ? '' : 's'}</small></div>
            <div className="report-kpi"><span>Discounts given</span><strong>{fmt(d.totals.discounts)}</strong></div>
            <div className="report-kpi warn"><span>Sold on credit</span><strong>{fmt(d.totals.creditGiven)}</strong></div>
            <div className="report-kpi ok"><span>Debts collected</span><strong>{fmt(d.totals.debtCollected)}</strong></div>
            {d.totals.refunded > 0 && <div className="report-kpi warn"><span>Refunded</span><strong>{fmt(d.totals.refunded)}</strong></div>}
          </div>
          {d.voided.count > 0 && (
            <p className="hint" style={{ marginTop: '.6rem' }}>
              {d.voided.count} voided sale{d.voided.count > 1 ? 's' : ''} ({fmt(d.voided.total)}) not counted in the totals.
            </p>
          )}

          {d.sales.length === 0 ? (
            <p className="empty">No sales on this day{d.debtPayments.length ? ', but debt payments were received (below).' : '.'}</p>
          ) : (
            <div className="viz-grid">
              <Panel title="Money received" sub="Sales and debt payments, less refunds">
                <div className="tablewrap">
                  <table>
                    <tbody>
                      {d.byMethod.map((m) => <tr key={m.method}><td>{m.method}</td><td className="num"><strong>{fmt(m.amount)}</strong></td></tr>)}
                      <tr className="sum"><td>Total received</td><td className="num">{fmt(d.totalReceived)}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div className="cash-check">
                  <div><span>Cash from sales</span><span>{fmt(d.cash.sales)}</span></div>
                  {d.cash.debts > 0 && <div><span>+ Cash debt payments</span><span>{fmt(d.cash.debts)}</span></div>}
                  {d.cash.refunds > 0 && <div><span>− Cash refunds</span><span>{fmt(d.cash.refunds)}</span></div>}
                  <div className="total"><span>Cash that should be in the drawer</span><span>{fmt(d.cash.expected)}</span></div>
                  <p className="hint">Plus any opening float. Compare with the shift cash-up count.</p>
                </div>
              </Panel>

              <Panel title="Sales through the day" sub={busiest ? `Busiest: ${hourLabel(busiest.hour)}–${hourLabel((busiest.hour + 1) % 24)} with ${busiest.sales} sale${busiest.sales === 1 ? '' : 's'}` : 'Number of sales each hour'}>
                <BarChart
                  slotProps={{ tooltip: { trigger: 'axis' } }}
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

              {unitTotal > 0 && (
                <Panel title="Single pieces and full packs" sub="How the day's sales were bought" wide>
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
                </Panel>
              )}

              <Panel title="Items sold" sub="Every product sold today, after returns" wide>
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Product</th><th>Sold</th><th className="num">Pieces</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
                    <tbody>
                      {d.items.map((r) => (
                        <tr key={r.id}>
                          <td>{r.name}{r.sku && <span className="muted-cell"> · {r.sku}</span>}</td>
                          <td>{soldLabel(r)}</td>
                          <td className="num">{qtyFmt(r.qty)}</td>
                          <td className="num"><strong>{fmt(r.revenue)}</strong></td>
                          <td className={`num${r.profit < 0 ? ' owes' : ''}`}>{fmt(r.profit)}</td>
                        </tr>
                      ))}
                      {d.items.length === 0 && <tr><td colSpan="5" className="empty">Everything sold was returned.</td></tr>}
                      {d.items.length > 0 && (
                        <tr className="sum">
                          <td colSpan="2">Total</td>
                          <td className="num">{qtyFmt(d.totals.itemsSold)}</td>
                          <td className="num">{fmt(d.items.reduce((t, r) => t + r.revenue, 0))}</td>
                          <td className="num">{fmt(d.items.reduce((t, r) => t + r.profit, 0))}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {d.totals.discounts > 0 && <p className="hint">Item revenue is before whole-sale discounts; the total sold above is after them.</p>}
              </Panel>

              <Panel title="By cashier" wide={d.cashiers.length > 3}>
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Cashier</th><th className="num">Sales</th><th className="num">Total sold</th></tr></thead>
                    <tbody>
                      {d.cashiers.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{c.sales}</td><td className="num"><strong>{fmt(c.revenue)}</strong></td></tr>)}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}

          {d.sales.length > 0 && (
            <>
              <div className="report-section-title">All sales ({d.sales.length})</div>
              <p className="hint no-print">Tap a sale to see its receipt.</p>
              <div className="tablewrap">
                <table className="daily-sales">
                  <thead><tr><th>Time</th><th>Receipt</th><th>Cashier</th><th>Customer</th><th className="num">Items</th><th>Paid by</th><th className="num">Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {salesShown.map((s) => (
                      <tr key={s.id} className="clickable" onClick={() => openReceipt(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openReceipt(s.id)}>
                        <td>{time(s.at)}</td>
                        <td><strong>{s.receiptNo}</strong></td>
                        <td>{s.cashier}</td>
                        <td>{s.customer ? <>{s.customer}{s.customerPhone && <span className="muted-cell"> · {s.customerPhone}</span>}</> : <span className="muted-cell">—</span>}</td>
                        <td className="num">{qtyFmt(s.itemCount)}</td>
                        <td>
                          {s.payments.map((p) => `${p.method} ${fmt(p.amount)}`).join(' + ') || <span className="muted-cell">—</span>}
                          {s.owed > 0 && <span className="owes"> · owes {fmt(s.owed)}</span>}
                        </td>
                        <td className="num">
                          <strong>{fmt(s.status === 'completed' ? s.total : s.net)}</strong>
                          {s.status !== 'completed' && <span className="muted-cell"> of {fmt(s.total)}</span>}
                        </td>
                        <td><span className={`badge ${STATUS[s.status]?.[1] || ''}`}>{STATUS[s.status]?.[0] || s.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.sales.length > SHOW_SALES && (
                <div className="actions no-print" style={{ justifyContent: 'center' }}>
                  <button onClick={() => setAllSales((v) => !v)}>{allSales ? `Show first ${SHOW_SALES}` : `Show all ${d.sales.length} sales`}</button>
                </div>
              )}
            </>
          )}

          {d.refunds.length > 0 && (
            <>
              <div className="report-section-title">Refunds ({d.refunds.length})</div>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Time</th><th>Receipt</th><th>Reason</th><th>By</th><th>Method</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {d.refunds.map((r, i) => (
                      <tr key={i}><td>{time(r.at)}</td><td>{r.receiptNo}</td><td>{r.reason || <span className="muted-cell">—</span>}</td><td>{r.by}</td><td>{r.method}</td><td className="num"><strong>{fmt(r.amount)}</strong></td></tr>
                    ))}
                    <tr className="sum"><td colSpan="5">Total refunded</td><td className="num">{fmt(d.totals.refunded)}</td></tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {d.debtPayments.length > 0 && (
            <>
              <div className="report-section-title">Debt payments received ({d.debtPayments.length})</div>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Time</th><th>Customer</th><th>Note</th><th>Taken by</th><th>Method</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {d.debtPayments.map((p, i) => (
                      <tr key={i}><td>{time(p.at)}</td><td>{p.customer}</td><td>{p.note || <span className="muted-cell">—</span>}</td><td>{p.by}</td><td>{p.method}</td><td className="num"><strong>{fmt(p.amount)}</strong></td></tr>
                    ))}
                    <tr className="sum"><td colSpan="5">Total collected</td><td className="num">{fmt(d.totals.debtCollected)}</td></tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="hint daily-foot">Printed from Posify · times are shop time.</p>
        </div>
      )}

      {view && (
        <Modal title={view.receiptNo} onClose={() => setView(null)}>
          <Receipt sale={view} />
          <div className="actions">
            <button className="primary" onClick={() => window.print()}>Print receipt</button>
            <button onClick={() => setView(null)}>Close</button>
          </div>
        </Modal>
      )}
    </ThemeProvider>
  );
}
