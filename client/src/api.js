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
    throw new Error('Cannot reach the server. Check your internet connection and try again.');
  }
  if (res.status === 401 && token && !path.startsWith('/auth/login')) {
    setToken('');
    window.dispatchEvent(new Event('auth:expired'));
  }
  return res;
}

export async function api(path, opts) {
  // Intercept POST /sales when offline — queue locally instead of failing.
  if (!navigator.onLine && opts?.method === 'POST' && path === '/sales') {
    const id = await enqueueSale(opts.body);
    // Return a synthetic sale-like object so the Sell page can show a receipt stub.
    return {
      _offlineQueued: true,
      _queueId: id,
      receiptNo: `OFFLINE-${id}`,
      total: opts.body?.items
        ? opts.body.items.reduce((s, i) => s + (Number(i.qty) || 0), 0) // rough placeholder
        : 0,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
  }
  const res = await request(path, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
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
