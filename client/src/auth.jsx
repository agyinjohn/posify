import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken } from './api.js';
import { cacheClearAll, cacheEnable } from './cache.js';
import { clearProductCache } from './offlineDb.js';
import { setShopName } from './format.js';

// Forget every cached list when the session changes hands (see cache.js).
const forgetCaches = () => { cacheClearAll(); clearProductCache().catch(() => {}); };

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('pos_token')));
  const [notice, setNotice] = useState(''); // e.g. "This shop is suspended", shown on the sign-in page
  const signedIn = (r) => { setShopName(r.shop?.name); setUser(r.user); };

  useEffect(() => {
    if (!localStorage.getItem('pos_token')) return;
    api('/auth/me').then((r) => { cacheEnable(); signedIn(r); })
      .catch((e) => { setToken(''); if (e.code === 'SHOP_SUSPENDED') setNotice(e.message); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const out = () => { forgetCaches(); setUser(null); };
    const suspended = (e) => { setToken(''); forgetCaches(); setUser(null); setNotice(e.detail || 'This shop is suspended'); };
    window.addEventListener('auth:expired', out);
    window.addEventListener('shop:suspended', suspended);
    return () => { window.removeEventListener('auth:expired', out); window.removeEventListener('shop:suspended', suspended); };
  }, []);

  const login = async (username, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { username, password } });
    forgetCaches(); // anything left from a previous user
    cacheEnable();
    setToken(r.token);
    setNotice('');
    signedIn(r);
  };
  const logout = () => { setToken(''); forgetCaches(); setUser(null); };
  // Changing the password signs out every other session; this one carries on with the fresh token.
  const changePassword = async (currentPassword, newPassword) => {
    const r = await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    setToken(r.token);
    setUser(r.user);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, changePassword, notice, isOwner: user?.role === 'owner' }}>{children}</Ctx.Provider>;
}
