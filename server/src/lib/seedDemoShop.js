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

export async function seedDemoShop({ mode = '1', shopName = 'My shop', log = console.log } = {}) {
  const shops = await Shop.find({ name: new RegExp(`^${escape(shopName.trim())}$`, 'i') });
  if (shops.length === 0) return log(`[demo] No shop called "${shopName}". Set SEED_DEMO_SHOP to the shop's name.`);
  if (shops.length > 1) return log(`[demo] ${shops.length} shops are called "${shopName}". Rename one so the demo goes into the right shop.`);
  const shop = shops[0];
  if (!shop.owner) return log(`[demo] Shop "${shop.name}" has no owner yet. Skipped.`);
  const reset = String(mode).toLowerCase() === 'reset';

  return runAsShop(shop._id, async () => {
    const [products, sales] = await Promise.all([Product.countDocuments({}), Sale.countDocuments({})]);
    if (!reset && (products > 0 || sales > 0)) {
      return log(`[demo] "${shop.name}" already has ${products} products and ${sales} sales, so no demo data was added. Use SEED_DEMO=reset to replace it.`);
    }
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
    log(`[demo] "${shop.name}": added ${data.products.length} products, ${data.customers.length} customers, ${data.suppliers.length} suppliers, `
      + `${data.sales.length} sales, ${data.payments.length} debt payments.${reset ? ' Remove SEED_DEMO=reset after the demo or it will wipe and reseed on every restart.' : ''}`);
    return data;
  });
}
