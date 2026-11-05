import mongoose from 'mongoose';
import Shop from '../models/Shop.js';
import { receiptCounterId } from '../models/Counter.js';

/**
 * One-time upgrade from the single-shop version, safe to run on every start (it does nothing once done):
 *  1. Records with no shop (everything from before) are given the first shop, created if needed.
 *  2. That shop's receipt numbers continue from the old shared counter.
 *  3. Indexes are synced, which drops the old shop-wide unique rules (SKU, barcode, receipt number, open shift)
 *     in favour of the per-shop ones in the schemas.
 * Uses the raw collections for writes, so it is not blocked by the shop-scoping plugin or immutable fields.
 */
// One line for the start-up log, so every start confirms the state of the data (not only the first one).
export function statusLine({ shops, active, missing, legacyLeft = 0 }) {
  const list = Object.entries(missing).filter(([, n]) => n > 0);
  const head = `[migrate] Status: ${shops} shop${shops === 1 ? '' : 's'} (${active} active)`;
  const rules = legacyLeft ? `; WARNING: ${legacyLeft} old shop-wide unique rule${legacyLeft === 1 ? '' : 's'} still in place (see errors above)` : '';
  if (!list.length) return `${head}; every record belongs to a shop${rules || '; unique rules are per shop'}.`;
  const total = list.reduce((t, [, n]) => t + n, 0);
  return `${head}; WARNING: ${total} record${total === 1 ? '' : 's'} still without a shop: ${list.map(([m, n]) => `${m} ${n}`).join(', ')}${rules}`;
}

// Unique indexes left from the single-shop version: unique, not including `shop`, and no longer in the schema
// (e.g. sku_1, barcode_1, receiptNo_1). Left in place they make a new shop's first SKU, barcode or receipt
// number clash with another shop's. Pure, so it is unit tested.
export function legacyUniqueIndexes(dbIndexes, schemaIndexes) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return dbIndexes.filter((ix) => ix.unique && ix.name !== '_id_' && !Object.hasOwn(ix.key, 'shop')
    && !schemaIndexes.some(([key, opts]) => opts?.unique && same(key, ix.key)));
}

const shopModels = () => Object.values(mongoose.models).filter((M) => M.modelName !== 'Shop' && M.schema.path('shop'));

export async function migrateToShops({ shopName = 'My shop', log = console.log } = {}) {
  const models = shopModels();
  const untouched = [];
  for (const M of models) if (await M.collection.findOne({ shop: { $exists: false } }, { projection: { _id: 1 } })) untouched.push(M);

  let first = await Shop.findOne().sort({ createdAt: 1 });
  if (untouched.length) {
    if (!first) {
      const owner = await mongoose.connection.collection('users').findOne({ role: 'owner' }, { sort: { createdAt: 1 } });
      // The existing owner already chose their own password: nothing temporary to show the platform admin.
      first = await Shop.create({ name: shopName, owner: owner?._id ?? null, ownerPasswordChangedAt: owner ? new Date() : null });
      log(`[migrate] Created shop "${first.name}" (${first._id}) for the existing data`);
    }
    for (const M of untouched) {
      const r = await M.collection.updateMany({ shop: { $exists: false } }, { $set: { shop: first._id } });
      log(`[migrate] ${M.modelName}: ${r.modifiedCount} record(s) moved into "${first.name}"`);
    }
  }

  // Blank barcodes saved as '' by an earlier import clash with each other under the per-shop unique rule:
  // turn them back into "no barcode".
  const blank = await mongoose.connection.collection('products').updateMany({ barcode: '' }, { $unset: { barcode: '' } });
  if (blank.modifiedCount) log(`[migrate] Product: cleared ${blank.modifiedCount} blank barcode(s) left by an earlier import`);

  // The old single counter becomes the first shop's, so its receipt numbers carry on (R-000124 after R-000123).
  const counters = mongoose.connection.collection('counters');
  const legacy = await counters.findOne({ _id: 'receipt' });
  if (legacy && first) {
    const id = receiptCounterId(first._id);
    const r = await counters.updateOne({ _id: id }, { $setOnInsert: { seq: legacy.seq, shop: first._id } }, { upsert: true });
    if (r.upsertedCount) log(`[migrate] Receipt numbers for "${first.name}" continue from R-${String(legacy.seq).padStart(6, '0')}`);
  }

  // Remove old shop-wide unique rules explicitly (and say so), then let Mongoose sync the rest.
  let legacyLeft = 0;
  for (const M of models) {
    const dbIndexes = await M.collection.indexes().catch(() => []);
    for (const ix of legacyUniqueIndexes(dbIndexes, M.schema.indexes())) {
      try {
        await M.collection.dropIndex(ix.name);
        log(`[migrate] ${M.modelName}: removed old shop-wide unique rule ${ix.name}`);
      } catch (err) {
        legacyLeft += 1;
        console.error(`[migrate] ${M.modelName}: could NOT remove old unique rule ${ix.name}: ${err.message}`);
      }
    }
  }
  for (const M of [...models, Shop]) {
    try {
      const dropped = await M.syncIndexes();
      if (dropped?.length) log(`[migrate] ${M.modelName}: replaced old indexes ${dropped.join(', ')}`);
    } catch (err) {
      console.error(`[migrate] ${M.modelName}: could not sync indexes (${err.message})`);
    }
  }
  // Re-check after syncing: anything still shop-wide is reported on every start until it is gone.
  for (const M of models) legacyLeft += legacyUniqueIndexes(await M.collection.indexes().catch(() => []), M.schema.indexes()).length;

  const missing = {};
  for (const M of models) missing[M.modelName] = await M.collection.countDocuments({ shop: { $exists: false } });
  const [shops, active] = await Promise.all([Shop.countDocuments({}), Shop.countDocuments({ active: true })]);
  log(statusLine({ shops, active, missing, legacyLeft }));
  return { migrated: untouched.map((M) => M.modelName), shop: first?._id ?? null, missing };
}
