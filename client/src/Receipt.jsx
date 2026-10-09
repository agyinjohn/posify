import { dateTime, fmt, qtyFmt, SHOP_NAME } from './format.js';

export default function Receipt({ sale }) {
  if (sale._offlineQueued) return null; // stub — caller renders its own notice
  return (
    <div className="receipt print-area">
      <h3>{SHOP_NAME}</h3>
      <p className="center">{sale.receiptNo} · {dateTime(sale.createdAt)}</p>
      {sale.cashier?.name && <p className="center">Served by {sale.cashier.name}</p>}
      {sale.customerName && <p className="center">Customer: {sale.customerName}</p>}
      {sale.status === 'voided' && <p className="center void">VOIDED</p>}
      <table>
        <tbody>
          {sale.items.map((it, i) => (
            <tr key={i}>
              <td>{it.name}<br /><small>{it.packQty ? `${qtyFmt(it.packQty)} ${it.packLabel} (${qtyFmt(it.qty)} pcs)` : qtyFmt(it.qty)} × {fmt(it.unitPrice)}{it.discount ? ` (−${fmt(it.discount)})` : ''}</small></td>
              <td className="num">{fmt(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rule" />
      {sale.orderDiscount > 0 && <div className="row"><span>Discount</span><span>−{fmt(sale.orderDiscount)}</span></div>}
      <div className="row total"><span>Total</span><span>{fmt(sale.total)}</span></div>
      {sale.payments.map((p, i) => <div className="row" key={i}><span>{p.method}</span><span>{fmt(p.amount)}</span></div>)}
      {sale.change > 0 && <div className="row"><span>Change</span><span>{fmt(sale.change)}</span></div>}
      {sale.balance > 0 && <div className="row"><span>Owing on credit</span><span>{fmt(sale.balance)}</span></div>}
      <p className="center thanks">Thank you for shopping with us.</p>
    </div>
  );
}
