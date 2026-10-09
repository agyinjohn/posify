// Simple cache: in-memory with sessionStorage fallback.
// Keys are URL strings. TTL defaults to 30 seconds for mutable data.

const mem = new Map(); // key -> { data, exp }

export function cacheSet(key, data, ttlMs = 30_000) {
  const exp = Date.now() + ttlMs;
  mem.set(key, { data, exp });
  try { sessionStorage.setItem(`pos_cache:${key}`, JSON.stringify({ data, exp })); } catch {}
}

export function cacheGet(key) {
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
