import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

/**
 * Multi-shop data separation. Every shop's records live in the same collections and carry a `shop` id.
 * The signed-in user's shop is held for the whole request (AsyncLocalStorage), and the plugin below adds it to
 * every read, update, delete, insert and aggregation on a shop-owned model.
 *
 * It FAILS CLOSED: an operation on shop data with no shop in context throws instead of touching every shop.
 * Code that genuinely works across shops (sign-in lookup, the platform admin, start-up migration) must say so
 * with the query option { skipTenant: true }, or stamp `shop` on the records it writes itself.
 */
export const tenantStore = new AsyncLocalStorage();
export const currentShop = () => tenantStore.getStore()?.shop ?? null;
export const runAsShop = (shop, fn) => tenantStore.run({ shop: String(shop) }, fn);

export class TenantContextError extends Error {}

const oid = (id) => new mongoose.Types.ObjectId(String(id));

// ── Pure helpers (unit tested) ────────────────────────────────────────────────────────────────
export const scopeFilter = (filter, shop) => ({ ...(filter || {}), shop: oid(shop) });

export function stampDocs(docs, shop) {
  for (const d of [].concat(docs || [])) {
    if (!d) continue;
    if (d.shop && String(d.shop) !== String(shop)) throw new TenantContextError('A record for another shop cannot be written here');
    d.shop = oid(shop);
  }
  return docs;
}

export function scopeBulkOps(ops, shop) {
  for (const op of ops || []) {
    const [kind] = Object.keys(op);
    const body = op[kind];
    if (kind === 'insertOne') stampDocs(body.document, shop);
    else if (kind === 'replaceOne') { body.filter = scopeFilter(body.filter, shop); stampDocs(body.replacement, shop); }
    else if (['updateOne', 'updateMany', 'deleteOne', 'deleteMany'].includes(kind)) body.filter = scopeFilter(body.filter, shop);
    else throw new TenantContextError(`Unsupported bulk operation ${kind}`);
  }
  return ops;
}

// The shop for this operation, or null when the caller opted out with { skipTenant: true }.
function shopFor(options, what) {
  if (options?.skipTenant) return null;
  const shop = currentShop();
  if (!shop) throw new TenantContextError(`No shop in context for ${what}`);
  return shop;
}

export const QUERY_OPS = ['countDocuments', 'distinct', 'find', 'findOne', 'findOneAndReplace', 'findOneAndUpdate',
  'replaceOne', 'updateMany', 'updateOne', 'deleteMany', 'deleteOne', 'findOneAndDelete'];

export function tenantPlugin(schema) {
  schema.add({ shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true, immutable: true } });

  for (const op of QUERY_OPS) {
    schema.pre(op, { document: false, query: true }, function () {
      const shop = shopFor(this.getOptions(), `${this.model.modelName}.${op}`);
      if (!shop) return;
      this.where({ shop: oid(shop) });
      if (op === 'replaceOne' || op === 'findOneAndReplace') stampDocs(this.getUpdate(), shop);
    });
  }
  schema.pre('estimatedDocumentCount', function () {
    if (!this.getOptions().skipTenant) throw new TenantContextError('estimatedDocumentCount counts every shop; use countDocuments');
  });
  schema.pre('aggregate', function () {
    const shop = shopFor(this.options, `${this._model?.modelName}.aggregate`);
    if (shop) this.pipeline().unshift({ $match: { shop: oid(shop) } });
  });
  // New records get the current shop; a record that already names a shop must match it. Runs on 'validate'
  // (before 'save'), so the required `shop` is filled in before validation checks it.
  schema.pre('validate', function () {
    const shop = currentShop();
    if (this.isNew && !this.shop) {
      if (!shop) throw new TenantContextError(`No shop in context to create ${this.constructor.modelName}`);
      this.shop = oid(shop);
    } else if (shop && this.shop && String(this.shop) !== shop) {
      throw new TenantContextError('A record for another shop cannot be saved here');
    }
  });
  schema.pre('insertMany', function (next, docs, options) {
    try {
      if (!options?.skipTenant) {
        const shop = currentShop();
        if (shop) stampDocs(docs, shop);
        else if ([].concat(docs).some((d) => !d?.shop)) throw new TenantContextError(`No shop in context for ${this.modelName}.insertMany`);
      }
      next();
    } catch (err) { next(err); }
  });
  schema.pre('bulkWrite', function (next, ops, options) {
    try {
      const shop = shopFor(options, `${this.modelName}.bulkWrite`);
      if (shop) scopeBulkOps(ops, shop);
      next();
    } catch (err) { next(err); }
  });
}
