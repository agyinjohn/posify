/**
 * offlineDb.js — thin IndexedDB wrapper.
 *
 * Object stores
 *   sale_queue  : queued sales waiting to sync
 *     { id (autoIncrement PK), queuedAt, payload, status:'pending'|'error', error? }
 *   product_cache : last-known product list
 *     { id: 'all', data: Product[], cachedAt }
 */

const DB_NAME = 'pos_offline';
const DB_VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sale_queue')) {
        const qs = db.createObjectStore('sale_queue', { keyPath: 'id', autoIncrement: true });
        qs.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('product_cache')) {
        db.createObjectStore('product_cache', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Promisify a single IDBRequest.
function req(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}

// ── Sale queue ────────────────────────────────────────────────────────────────

export async function enqueueSale(payload) {
  const db = await open();
  const tx = db.transaction('sale_queue', 'readwrite');
  const id = await req(tx.objectStore('sale_queue').add({
    queuedAt: new Date().toISOString(),
    payload,
    status: 'pending',
    error: null,
  }));
  return id;
}

export async function getAllQueued() {
  const db = await open();
  return req(db.transaction('sale_queue', 'readonly').objectStore('sale_queue').getAll());
}

export async function markSynced(id) {
  const db = await open();
  return req(db.transaction('sale_queue', 'readwrite').objectStore('sale_queue').delete(id));
}

export async function markFailed(id, errorMessage) {
  const db = await open();
  const store = db.transaction('sale_queue', 'readwrite').objectStore('sale_queue');
  const item = await req(store.get(id));
  if (!item) return;
  item.status = 'error';
  item.error = errorMessage;
  return req(store.put(item));
}

export async function discardQueued(id) {
  const db = await open();
  return req(db.transaction('sale_queue', 'readwrite').objectStore('sale_queue').delete(id));
}

export async function retryQueued(id) {
  const db = await open();
  const store = db.transaction('sale_queue', 'readwrite').objectStore('sale_queue');
  const item = await req(store.get(id));
  if (!item) return;
  item.status = 'pending';
  item.error = null;
  return req(store.put(item));
}

// ── Product cache ─────────────────────────────────────────────────────────────

export async function cacheProducts(products) {
  const db = await open();
  return req(
    db.transaction('product_cache', 'readwrite')
      .objectStore('product_cache')
      .put({ id: 'all', data: products, cachedAt: new Date().toISOString() }),
  );
}

export async function getCachedProducts() {
  const db = await open();
  const row = await req(
    db.transaction('product_cache', 'readonly').objectStore('product_cache').get('all'),
  );
  return row ?? null; // { data, cachedAt } or null
}
