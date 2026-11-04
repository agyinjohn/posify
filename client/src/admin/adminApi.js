// The platform admin's own session: a separate token from any shop sign-in on the same device.
const BASE = import.meta.env.VITE_API_URL || '/api';
const KEY = 'pos_admin_token';
let token = localStorage.getItem(KEY) || '';

export const setAdminToken = (t) => { token = t || ''; if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); };
export const hasAdminToken = () => Boolean(token);

export async function adminApi(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/admin${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token && path !== '/login') { setAdminToken(''); window.dispatchEvent(new Event('admin:expired')); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
