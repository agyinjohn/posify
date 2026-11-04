import { enqueueSale } from './offlineDb.js';

const BASE = import.meta.env.VITE_API_URL || '/api';
let token = localStorage.getItem('pos_token') || '';

export const setToken = (t) => {
  token = t || '';
  if (t) localStorage.setItem('pos_token', t);
  else localStorage.removeItem('pos_token');
};

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  } catch {
    throw Object.assign(new Error('Cannot reach the server. Check your internet connection and try again.'), { network: true });
  }
  if (res.status === 401 && token && !path.startsWith('/auth/login')) {
    setToken('');
    window.dispatchEvent(new Event('auth:expired'));
  }
  return res;
}

// Save a sale on this device to be sent later, and hand back a stub the Sell page can show.
async function queueSale(body) {
  const id = await enqueueSale(body);
  return {
    _offlineQueued: true,
    _queueId: id,
    receiptNo: `OFFLINE-${id}`,
    total: 0,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
}

export async function api(path, opts) {
  const isSale = opts?.method === 'POST' && path === '/sales';
  // Offline: queue the sale locally instead of failing.
  if (isSale && !navigator.onLine) return queueSale(opts.body);

  let res;
  try {
    res = await request(path, opts);
  } catch (err) {
    // "Online" but the server is unreachable (weak wifi): queue too. The sale carries a clientId,
    // so if the first attempt actually got through, syncing returns that sale instead of a duplicate.
    if (isSale && err.network) return queueSale(opts.body);
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // The platform admin suspended this shop: every screen stops, the app signs out and says why.
    if (data?.code === 'SHOP_SUSPENDED' && token) window.dispatchEvent(new CustomEvent('shop:suspended', { detail: data.error }));
    throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, code: data?.code });
  }
  return data;
}

export async function download(path, filename) {
  const res = await request(path);
  if (!res.ok) throw new Error('Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
