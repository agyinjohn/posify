import mongoose from 'mongoose';
import { priceSale, settlePayments } from './pricing.js';
import { planReturn } from './returns.js';
import { r2, r3 } from './money.js';

/**
 * Demo data for a sales demo: a Ghanaian mini-mart with a small clothing corner, about six weeks of trading.
 * buildDemoData is pure (no database) and uses the same pricing and return rules as the till, so every figure
 * in the reports adds up. seedDemoShop (below) writes it into one shop. Dates are UTC = Ghana time.
 */

const DAY = 86_400_000;

// [name, size, colour, category, cost per piece, price per piece, pieces per pack, pack name, pack price, popularity, stock left]
const CATALOGUE = [
  ['Royal Aroma Rice', '5kg', '', 'Grains', 98, 125, 1, '', 0, 6, 14],
  ['Royal Aroma Rice', '25kg', '', 'Grains', 460, 560, 1, '', 0, 2, 4],
  ['Frytol Cooking Oil', '1L', '', 'Oils', 32, 40, 12, 'ctn', 450, 6, 30],
  ['Gino Tomato Paste', '70g', '', 'Provisions', 2.1, 3, 50, 'ctn', 135, 8, 120],
  ['Peak Milk', '160g tin', '', 'Provisions', 9.5, 12, 48, 'ctn', 540, 7, 3],
  ['Milo', '400g', '', 'Beverages', 42, 52, 12, 'ctn', 590, 5, 18],
  ['Ideal Milk', '160g tin', '', 'Provisions', 7.5, 10, 48, 'ctn', 450, 5, 60],
  ['Indomie Chicken', '70g', '', 'Provisions', 3.6, 5, 40, 'ctn', 185, 9, 0],
  ['Sugar', '1kg', '', 'Provisions', 14, 18, 10, 'bag', 170, 5, 25],
  ['Malt Guinness', '330ml', '', 'Drinks', 9, 12, 24, 'crate', 270, 8, 48],
  ['Coca-Cola', '500ml', '', 'Drinks', 6.5, 9, 12, 'pack', 100, 8, 36],
  ['Voltic Water', '500ml', '', 'Drinks', 1.6, 2.5, 15, 'pack', 33, 9, 150],
  ['Bel Aqua Water', '1.5L', '', 'Drinks', 5, 7, 6, 'pack', 40, 4, 2],
  ['Key Soap', '', '', 'Toiletries', 4.5, 6, 36, 'box', 205, 6, 70],
  ['Pepsodent Toothpaste', '140g', '', 'Toiletries', 11, 15, 12, 'ctn', 170, 4, 20],
  ['Always Pads', 'Regular', '', 'Toiletries', 14, 19, 1, '', 0, 3, 16],
  ['Omo Detergent', '500g', '', 'Household', 16, 22, 1, '', 0, 4, 1],
  ['Tissue Roll', '', '', 'Household', 2.8, 4, 10, 'pack', 36, 5, 90],
  ['Nido Milk Powder', '400g', '', 'Beverages', 58, 72, 1, '', 0, 3, 9],
  ['Shea Butter', '250g', '', 'Beauty', 15, 25, 1, '', 0, 2, 11],
  // Clothing corner: one product per size and colour
  ['Kente Print Shirt', 'M', 'Blue', 'Clothing', 85, 150, 1, '', 0, 1, 4],
  ['Kente Print Shirt', 'L', 'Blue', 'Clothing', 85, 150, 1, '', 0, 1, 2],
  ['Kente Print Shirt', 'XL', 'Blue', 'Clothing', 90, 160, 1, '', 0, 1, 0],
  ['Kente Print Shirt', 'M', 'Red', 'Clothing', 85, 150, 1, '', 0, 1, 3],
  ['Kente Print Shirt', 'L', 'Red', 'Clothing', 85, 150, 1, '', 0, 1, 5],
  ['Ladies Ankara Dress', 'S', 'Navy', 'Clothing', 120, 220, 1, '', 0, 1, 2],
  ['Ladies Ankara Dress', 'M', 'Navy', 'Clothing', 120, 220, 1, '', 0, 1, 3],
  ['Ladies Ankara Dress', 'M', 'Green', 'Clothing', 120, 220, 1, '', 0, 1, 1],
  ['Ladies Ankara Dress', 'L', 'Green', 'Clothing', 125, 230, 1, '', 0, 1, 4],
  ['Canvas Sneakers', '41', 'White', 'Footwear', 110, 180, 1, '', 0, 1, 3],
  ['Canvas Sneakers', '42', 'White', 'Footwear', 110, 180, 1, '', 0, 1, 2],
  ['Canvas Sneakers', '43', 'White', 'Footwear', 110, 180, 1, '', 0, 1, 1],
];

const CUSTOMERS = [
  ['Auntie Akos Provisions', '0244 512 330', 2000], ['Kwame Mensah', '0201 778 214', 500], ['Yaa Asantewaa', '0277 330 961', 800],
  ['Kofi Boateng', '0545 219 007', 0], ['Esi Owusu', '0249 661 425', 300], ['Mama Comfort Chop Bar', '0208 145 590', 1500],
  ['Daniel Ofori', '0553 902 118', 0], ['Abena Darko', '0266 471 832', 400],
];
const SUPPLIERS = [
  ['Melcom Wholesale', '0302 225 561', 'Kaneshie, Accra'], ['Kasapreko Distributors', '0302 811 400', 'Spintex Road, Accra'],
  ['Unilever Ghana Depot', '0302 210 990', 'Tema Industrial Area'], ['Makola Fabrics Ltd', '0244 900 731', 'Makola Market, Accra'],
];
const RETURN_REASONS = ['Wrong size', 'Customer changed mind', 'Damaged item', 'Expired item'];

// Small seeded random generator, so the demo looks the same on every run with the same seed.
const rng = (seed) => { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };

export function buildDemoData({ now = new Date(), days = 42, seed = 20261118, ownerId, cashierIds = [] } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const oid = () => new mongoose.Types.ObjectId();
  const staff = [ownerId, ...cashierIds].filter(Boolean);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(today - days * DAY);

  const products = CATALOGUE.map(([name, size, color, category, cost, price, units, packLabel, packPrice, weight, left], i) => ({
    _id: oid(), name, size, color, category, costPrice: cost, retailPrice: price, unitsPerPack: units, packLabel,
    packRetailPrice: units > 1 ? packPrice : 0, wholesalePrice: 0, packWholesalePrice: 0, reorderLevel: units > 1 ? units : 3,
    sku: `DEMO-${String(i + 1).padStart(3, '0')}`, active: true, stock: 0, weight, left, createdAt: start, updatedAt: start,
  }));
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const pool = products.flatMap((p) => Array(p.weight).fill(p)); // popular products come up more often

  const customers = CUSTOMERS.map(([name, phone, creditLimit]) => ({ _id: oid(), name, phone, creditLimit, balance: 0, createdAt: start, updatedAt: start }));
  const creditCustomers = customers.filter((c) => c.creditLimit > 0);
  const suppliers = SUPPLIERS.map(([name, phone, address]) => ({ _id: oid(), name, phone, address, createdAt: start, updatedAt: start }));

  const sales = []; const moves = []; const refunds = []; const creditNotes = []; const payments = [];
  const sold = new Map(); // product id -> pieces sold (net)
  let receipt = 0;

  for (let d = days; d >= 0; d--) {
    const dayStart = today - d * DAY;
    const dow = new Date(dayStart).getUTCDay();
    const count = Math.round((dow === 6 ? 22 : dow === 0 ? 8 : dow === 5 ? 18 : 14) * (0.75 + rand() * 0.5));
    for (let k = 0; k < count; k++) {
      const hour = Math.min(20, Math.max(7, Math.round(13 + (rand() + rand() + rand() - 1.5) * 6)));
      const at = new Date(dayStart + hour * 3_600_000 + Math.floor(rand() * 3_600_000));
      if (at > now) continue;

      // The basket: 1–4 products; packed goods are sometimes bought by the pack (wholesale).
      const lines = []; const used = new Set();
      const n = 1 + Math.floor(rand() * rand() * 4);
      for (let l = 0; l < n; l++) {
        const p = pick(pool);
        if (used.has(String(p._id))) continue;
        used.add(String(p._id));
        const byPack = p.unitsPerPack > 1 && rand() < 0.22;
        lines.push({ productId: String(p._id), unit: byPack ? 'pack' : 'piece', qty: byPack ? 1 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * rand() * 5) });
      }
      const discount = rand() < 0.06 ? 5 : 0;
      let priced;
      try { priced = priceSale({ lines, productsById: byId, mode: 'retail', orderDiscount: discount }); } catch { continue; }

      // Who and how: walk-ins pay cash or MoMo; regulars sometimes buy on credit.
      const credit = rand() < 0.07 && creditCustomers.length > 0;
      const customer = credit ? pick(creditCustomers) : rand() < 0.2 ? pick(customers) : null;
      const r = rand();
      const method = r < 0.52 ? 'Cash' : r < 0.88 ? 'MoMo' : r < 0.95 ? 'Card' : 'Transfer';
      const pays = credit
        ? (rand() < 0.5 ? [] : [{ method, amount: r2(Math.floor(priced.total * (0.3 + rand() * 0.4))) }])
        : [{ method, amount: method === 'Cash' && rand() < 0.5 ? Math.ceil(priced.total / 10) * 10 : priced.total }];
      const settled = settlePayments(pays.filter((p) => p.amount > 0), priced.total);
      receipt += 1;
      const sale = {
        _id: oid(), receiptNo: `R-${String(receipt).padStart(6, '0')}`, mode: 'retail', ...priced,
        items: priced.items.map((it) => ({ ...it, returnedQty: 0 })),
        payments: settled.payments, amountPaid: settled.amountPaid, change: settled.change, balance: settled.balance,
        customer: customer?._id, customerName: customer?.name, customerPhone: customer?.phone,
        cashier: pick(staff), status: 'completed', creditReturned: 0, refundedTotal: 0, rev: 0, createdAt: at, updatedAt: at,
      };
      if (customer && sale.balance > 0) customer.balance = r2(customer.balance + sale.balance);
      for (const it of sale.items) {
        moves.push({ _id: oid(), product: it.product, type: 'sale', qty: -it.qty, costPrice: it.costPrice, sale: sale._id, user: sale.cashier, createdAt: at, updatedAt: at });
        sold.set(String(it.product), r3((sold.get(String(it.product)) || 0) + it.qty));
      }

      // A few come back: a part return or a full void, refunded in cash (credit is cancelled first).
      const back = !credit && rand() < 0.03;
      if (back) {
        const isVoid = rand() < 0.35;
        const first = sale.items[0];
        const plan = planReturn(sale, isVoid ? { all: true } : { lines: [{ productId: first.product, qty: Math.min(first.qty, 1) }] });
        const when = new Date(Math.min(at.getTime() + (1 + rand() * 30) * 3_600_000, now.getTime()));
        const reason = isVoid ? 'Rang up by mistake' : pick(RETURN_REASONS);
        for (const u of plan.updates) {
          sale.items[u.index].returnedQty = u.returnedQty;
          moves.push({ _id: oid(), product: u.productId, type: isVoid ? 'void' : 'return', qty: u.qty, costPrice: u.costPrice, sale: sale._id,
            reason: `${isVoid ? 'Void' : 'Return'} ${sale.receiptNo}${isVoid ? '' : `: ${reason}`}`, user: ownerId, createdAt: when, updatedAt: when });
          sold.set(String(u.productId), r3(sold.get(String(u.productId)) - u.qty));
        }
        sale.status = plan.fullyReturned ? 'voided' : 'partial-return';
        if (plan.fullyReturned) Object.assign(sale, { voidReason: reason, voidedBy: ownerId, voidedAt: when });
        sale.refundedTotal = plan.cashRefund;
        if (plan.cashRefund > 0) refunds.push({ _id: oid(), sale: sale._id, receiptNo: sale.receiptNo, method: 'Cash', amount: plan.cashRefund, reason, user: ownerId, createdAt: when });
      }
      sales.push(sale);
    }

    // Regulars pay off part of what they owe now and then.
    for (const c of creditCustomers) {
      if (c.balance > 20 && rand() < 0.12) {
        const amount = r2(Math.min(c.balance, Math.max(20, Math.round(c.balance * (0.3 + rand() * 0.5)))));
        const at = new Date(Math.min(dayStart + (9 + Math.floor(rand() * 9)) * 3_600_000, now.getTime()));
        c.balance = r2(c.balance - amount);
        payments.push({ _id: oid(), customer: c._id, amount, method: rand() < 0.6 ? 'MoMo' : 'Cash', note: 'Part payment', user: pick(staff), createdAt: at });
      }
    }
  }

  // Opening stock = what was sold + what is left now, so stock never goes below zero and some items end low.
  for (const p of products) {
    const out = sold.get(String(p._id)) || 0;
    p.stock = p.left;
    const opening = r3(out + p.left);
    if (opening > 0) moves.push({ _id: oid(), product: p._id, type: 'opening', qty: opening, costPrice: p.costPrice, reason: 'Opening stock', user: ownerId, createdAt: start, updatedAt: start });
    delete p.weight; delete p.left;
  }
  return { products, customers, suppliers, sales, moves, refunds, creditNotes, payments, receipts: receipt };
}
