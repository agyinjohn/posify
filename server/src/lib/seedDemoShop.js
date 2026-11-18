import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import Shop from '../models/Shop.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import StockTake from '../models/StockTake.js';
import Sale from '../models/Sale.js';
import Refund from '../models/Refund.js';
import CreditNote from '../models/CreditNote.js';
import CustomerPayment from '../models/CustomerPayment.js';
import Counter, { receiptCounterId } from '../models/Counter.js';
import { runAsShop } from './tenant.js';
import { clearShopSales } from './clearSales.js';
import { buildDemoData } from './demoSeed.js';

/**
 * SEED_DEMO on the server: fill one shop (SEED_DEMO_SHOP, default "My shop") with demo data at start-up.
 *   SEED_DEMO=1      only when that shop has no products and no sales yet (safe to leave on)
 *   SEED_DEMO=reset  wipe that shop's products, customers, suppliers and sales, then seed fresh data (every restart!)
 * Users, passwords and the shop itself are never touched, apart from two demo cashier accounts it adds.
 */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DEMO_CASHIERS = [['Ama Serwaa', 'ama.demo'], ['Kojo Antwi', 'kojo.demo']];

// Is this the shop the demo may replace? Only the one named in SEED_DEMO_SHOP (default "My shop"), so a real
// client's data can never be wiped with the demo button.
export const demoShopName = () => (process.env.SEED_DEMO_SHOP || 'My shop').trim();
export const isDemoShop = (shop) => shop?.name?.trim().toLowerCase() === demoShopName().toLowerCase();

export async function demoStatus(shop) {
  return runAsShop(shop._id, async () => {
    const [products, sales] = await Promise.all([Product.countDocuments({}), Sale.countDocuments({})]);
    return { empty: products === 0 && sales === 0, products, sales, canReplace: isDemoShop(shop), demoShop: demoShopName() };
  });
}

// Fill one shop with demo data. reset: first wipe its products, customers, suppliers and sales.
export async function seedShop(shop, { reset = false, log = console.log } = {}) {
  if (!shop.owner) throw new Error(`Shop "${shop.name}" has no owner yet`);
  return runAsShop(shop._id, async () => {
    if (reset) {
      await clearShopSales(shop._id, { restoreStock: false });
      await Promise.all([Product, StockMovement, Customer, Supplier, PurchaseOrder, StockTake].map((M) => M.deleteMany({})));
      log(`[demo] Cleared "${shop.name}" (products, customers, suppliers, sales).`);
    }
    // Two cashier accounts so reports show sales by person. They get a random password (the owner can reset it).
    const cashierIds = [];
    for (const [name, base] of DEMO_CASHIERS) {
      const alt = `${base}.${String(shop._id).slice(-4)}`; // usernames are unique across all shops
      let user = await User.findOne({ username: { $in: [base, alt] } }); // this shop only (tenant scope)
      if (!user) {
        const username = (await User.exists({ username: base }).setOptions({ skipTenant: true })) ? alt : base;
        user = await User.create({ name, username, role: 'cashier', passwordHash: await bcrypt.hash(crypto.randomBytes(18).toString('base64url'), 10) });
      }
      cashierIds.push(user._id);
    }
    const data = buildDemoData({ now: new Date(), ownerId: shop.owner, cashierIds });
    await Product.insertMany(data.products);
    await Customer.insertMany(data.customers);
    await Supplier.insertMany(data.suppliers);
    await Sale.insertMany(data.sales);
    await StockMovement.insertMany(data.moves);
    if (data.refunds.length) await Refund.insertMany(data.refunds);
    if (data.creditNotes.length) await CreditNote.insertMany(data.creditNotes);
    if (data.payments.length) await CustomerPayment.insertMany(data.payments);
    // Receipt numbers carry on after the demo ones.
    await Counter.updateOne({ _id: receiptCounterId(shop._id) }, { $set: { seq: data.receipts, shop: shop._id } }, { upsert: true, skipTenant: true });
    const summary = { products: data.products.length, customers: data.customers.length, suppliers: data.suppliers.length, sales: data.sales.length, debtPayments: data.payments.length };
    log(`[demo] "${shop.name}": added ${summary.products} products, ${summary.customers} customers, ${summary.suppliers} suppliers, ${summary.sales} sales, ${summary.debtPayments} debt payments.`);
    return summary;
  });
}

// Start-up (SEED_DEMO): find the shop by name and seed it if it is empty, or replace its data with reset.
export async function seedDemoShop({ mode = '1', shopName = demoShopName(), log = console.log } = {}) {
  const shops = await Shop.find({ name: new RegExp(`^${escape(shopName.trim())}$`, 'i') });
  if (shops.length === 0) return log(`[demo] No shop called "${shopName}". Set SEED_DEMO_SHOP to the shop's name.`);
  if (shops.length > 1) return log(`[demo] ${shops.length} shops are called "${shopName}". Rename one so the demo goes into the right shop.`);
  const shop = shops[0];
  if (!shop.owner) return log(`[demo] Shop "${shop.name}" has no owner yet. Skipped.`);
  const reset = String(mode).toLowerCase() === 'reset';
  const status = await demoStatus(shop);
  if (!reset && !status.empty) {
    return log(`[demo] "${shop.name}" already has ${status.products} products and ${status.sales} sales, so no demo data was added. Use SEED_DEMO=reset to replace it.`);
  }
  const out = await seedShop(shop, { reset, log });
  if (reset) log('[demo] Remove SEED_DEMO=reset after the demo, or it will wipe and reseed on every restart.');
  return out;
}
