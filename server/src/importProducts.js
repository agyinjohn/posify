// Load a product spreadsheet (CSV) into one shop from the server, e.g. to set up a new client.
//
//   npm run import-products -- --shop "Shop name" --file products.csv            (check only, writes nothing)
//   npm run import-products -- --shop "Shop name" --file products.csv --apply    (import)
//
// Same rules as Products > Import in the app: the same columns are understood, SKUs and barcodes left blank are
// made automatically, opening stock is recorded as stock history. Products whose SKU already exists are skipped
// (add --update to change their details and prices instead; stock is never changed for them).
import fs from 'node:fs';
import mongoose from 'mongoose';
import { config } from './config.js';
import Shop from './models/Shop.js';
import Product from './models/Product.js';
import StockMovement from './models/StockMovement.js';
import { runAsShop } from './lib/tenant.js';
import { parseCsv } from './lib/csv.js';
import { applyPlan, buildImportPlan, summarize } from './lib/productImport.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const shopName = opt('shop'); const file = opt('file');
const apply = args.includes('--apply'); const mode = args.includes('--update') ? 'update' : 'skip';
if (!shopName || !file) {
  console.error('Usage: npm run import-products -- --shop "Shop name" --file products.csv [--apply] [--update]');
  process.exit(1);
}

const [headers, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
if (!headers || !rows.length) { console.error('The file has no product rows'); process.exit(1); }

await mongoose.connect(config.mongoUri);
try {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shops = await Shop.find({ name: new RegExp(`^${escape(shopName.trim())}$`, 'i') });
  if (shops.length !== 1) throw new Error(shops.length ? `${shops.length} shops are called "${shopName}"` : `No shop called "${shopName}"`);
  const shop = shops[0];
  if (!shop.owner) throw new Error(`Shop "${shop.name}" has no owner yet`);

  await runAsShop(shop._id, async () => {
    const { plan, recognized, ignored } = await buildImportPlan({ Product, headers, rows, mode });
    const s = summarize(plan);
    console.log(`Shop: ${shop.name}`);
    console.log(`Columns used: ${recognized.map((r) => r.header ?? r).join(', ')}${ignored.length ? ` | ignored: ${ignored.join(', ')}` : ''}`);
    console.log(`Rows: ${s.total}  new: ${s.create}  update: ${s.update}  skip: ${s.skip}  errors: ${s.error}`);
    plan.filter((e) => e.status === 'error').forEach((e) => console.log(`  row ${e.row} ${e.name || ''}: ${e.errors.join('; ')}`));
    if (!apply) { console.log('\nNothing written. Run again with --apply to import.'); return; }

    const results = await applyPlan({ plan, Product, StockMovement, userId: shop.owner, newId: () => new mongoose.Types.ObjectId() });
    const failed = [...results].filter(([, r]) => !r.ok);
    failed.forEach(([row, r]) => console.log(`  row ${row}: ${r.message}`));
    const pieces = plan.filter((e) => e.status === 'create' && results.get(e.row)?.ok).reduce((t, e) => t + (e.data.stock || 0), 0);
    console.log(`\nImported: ${s.create + s.update - failed.length} products (${pieces} pieces of opening stock). Failed: ${s.error + failed.length}.`);
  });
} catch (err) {
  console.error(`Not imported: ${err.message}`);
  process.exitCode = 1;
}
await mongoose.disconnect();
