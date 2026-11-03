// Warms the data cache in the background so pages open instantly. Every key here is exactly the URL the
// page asks for first, so its stale-while-revalidate fetch finds the data already waiting.
import { api } from './api.js';
import { cacheGet, cacheSet } from './cache.js';
import { todayStr } from './format.js';

const TTL = 5 * 60_000; // pages still refresh on open; this only decides how long a warm copy is shown instantly

const keysFor = (isOwner) => {
  const t = todayStr();
  const common = ['/products', '/customers?q=', `/sales?from=${t}&to=${t}`];
  const owner = [
    '/products?all=1&q=', `/reports/daily?date=${t}`, '/reports/stock', '/shifts', '/suppliers?q=',
    '/purchase-orders', '/users', '/stock/movements', `/audit?from=${t}&to=${t}`,
  ];
  return isOwner ? [...common, ...owner] : common;
};

// What each screen needs, so hovering or touching a nav link can warm it a beat before the click.
const ROUTE_KEYS = (isOwner) => {
  const t = todayStr();
  return {
    '/': ['/products', '/customers?q='],
    '/sales': [`/sales?from=${t}&to=${t}`],
    '/customers': ['/customers?q='],
    '/products': isOwner ? ['/products?all=1&q='] : [],
    '/stock': ['/products', '/stock/movements'],
    '/suppliers': ['/suppliers?q=', '/purchase-orders'],
    '/reports': [`/reports/daily?date=${t}`, '/reports/stock'],
    '/shifts': ['/shifts'],
    '/users': ['/users'],
    '/audit': [`/audit?from=${t}&to=${t}`],
  };
};

const saveData = () => Boolean(navigator.connection?.saveData);

async function warm(path, force) {
  if (!navigator.onLine) return;
  if (!force && cacheGet(path) !== null) return; // still fresh
  try { cacheSet(path, await api(path), TTL); } catch { /* a page will report real errors when opened */ }
}

const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 300));

// Fetch the keys a few at a time, only while the browser has nothing better to do.
export function warmAll(isOwner, { force = false } = {}) {
  if (saveData() || document.hidden) return;
  const queue = [...keysFor(isOwner)];
  const worker = () => idle(async () => {
    const key = queue.shift();
    if (!key) return;
    await warm(key, force);
    worker();
  });
  worker(); worker(); // two at a time
}

export function warmRoute(path, isOwner) {
  if (saveData()) return;
  for (const key of ROUTE_KEYS(isOwner)[path] || []) warm(key, false);
}

// Start warming now, then keep the copies fresh while the app is open.
export function startPrefetch(isOwner) {
  warmAll(isOwner);
  const refresh = () => warmAll(isOwner, { force: true });
  const timer = setInterval(refresh, 60_000);
  const onVisible = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', refresh);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', refresh);
  };
}
