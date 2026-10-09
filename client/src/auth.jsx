import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('pos_token')));

  useEffect(() => {
    if (!localStorage.getItem('pos_token')) return;
    api('/auth/me').then((r) => setUser(r.user)).catch(() => setToken('')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('auth:expired', out);
    return () => window.removeEventListener('auth:expired', out);
  }, []);

  const login = async (username, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { username, password } });
    setToken(r.token);
    setUser(r.user);
  };
  const logout = () => { setToken(''); setUser(null); };

  return <Ctx.Provider value={{ user, loading, login, logout, isOwner: user?.role === 'owner' }}>{children}</Ctx.Provider>;
}
