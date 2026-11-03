// Simple cache: in-memory with sessionStorage fallback.
// Keys are URL strings. TTL defaults to 30 seconds for mutable data.

const mem = new Map(); // key -> { data, exp }

// Off between sign-out and the next sign-in, so a request still in flight when someone logs out
// cannot write the old user's data back into the cache.
let enabled = true;
export const cacheEnable = () => { enabled = true; };

export function cacheSet(key, data, ttlMs = 30_000) {
  if (!enabled) return;
  const exp = Date.now() + ttlMs;
  mem.set(key, { data, exp });
  persistLater(key, { data, exp });
}

// Writing a big list (thousands of products) to sessionStorage freezes the page for a moment, so it is
// done when the browser is idle. Memory already serves every in-session read; storage only helps after a reload.
const pending = new Map();
let scheduled = false;
function persistLater(key, entry) {
  pending.set(key, entry);
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    for (const [k, v] of pending) {
      try {
        const raw = JSON.stringify(v);
        if (raw.length < 1_000_000) sessionStorage.setItem(`pos_cache:${k}`, raw);
      } catch {}
    }
    pending.clear();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 500);
}

// Everything cached belongs to whoever is signed in (a cashier's lists have no costs, an owner's do),
// so it must never outlive the session.
export function cacheClearAll() {
  enabled = false;
  mem.clear();
  pending.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('pos_cache:')) sessionStorage.removeItem(k);
    }
  } catch {}
}

export function cacheGet(key) {
  if (!enabled) return null;
  let entry = mem.get(key);
  if (!entry) {
    try {
      const raw = sessionStorage.getItem(`pos_cache:${key}`);
      if (raw) { entry = JSON.parse(raw); mem.set(key, entry); }
    } catch {}
  }
  if (!entry) return null;
  if (Date.now() > entry.exp) { mem.delete(key); try { sessionStorage.removeItem(`pos_cache:${key}`); } catch {} return null; }
  return entry.data;
}

export function cacheInvalidate(...keys) {
  keys.forEach((k) => {
    mem.delete(k);
    try { sessionStorage.removeItem(`pos_cache:${k}`); } catch {}
  });
}

// Invalidate all keys that start with a prefix (e.g. '/products')
export function cacheInvalidatePrefix(prefix) {
  for (const k of mem.keys()) { if (k.startsWith(prefix)) mem.delete(k); }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(`pos_cache:${prefix}`)) sessionStorage.removeItem(k);
    }
  } catch {}
}

// Cached api wrapper — pass same args as api(), plus optional ttlMs.
import { api } from './api.js';
export async function cachedApi(path, ttlMs = 30_000) {
  const hit = cacheGet(path);
  if (hit !== null) return hit;
  const data = await api(path);
  cacheSet(path, data, ttlMs);
  return data;
}

// Stale-while-revalidate fetch. Returns { data, refreshing }.
// onData(data) called immediately with cache hit, then again with fresh data.
// onRefreshing(bool) lets the caller show/hide a background spinner.
export async function swrFetch(path, { onData, onRefreshing, ttlMs = 30_000 } = {}) {
  const cached = cacheGet(path);
  if (cached) onData?.(cached);
  onRefreshing?.(true);
  try {
    const fresh = await api(path);
    cacheSet(path, fresh, ttlMs);
    onData?.(fresh);
  } finally {
    onRefreshing?.(false);
  }
}
