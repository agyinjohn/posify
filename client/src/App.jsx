import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import ForcePasswordChange, { ChangePasswordModal } from './pages/ChangePassword.jsx';
import { RecoveryCodesModal, recoveryNeedsAttention, useRecoveryStatus } from './pages/RecoveryCodes.jsx';
import Sell from './pages/Sell.jsx';
import Sales from './pages/Sales.jsx';
import Customers from './pages/Customers.jsx';
import Products from './pages/Products.jsx';
import Stock from './pages/Stock.jsx';
// Reports and the dashboard carry the chart library, so they load on their own; owners fetch them in the background.
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
import Users from './pages/Users.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Shifts from './pages/Shifts.jsx';
import Suppliers from './pages/Suppliers.jsx';
import { QueueBadge, QueuePanel } from './pages/OfflineQueue.jsx';
import { SHOP_NAME, productLabel, qtyFmt } from './format.js';
import { useOfflineSync } from './offlineSync.js';
import { TableSkeleton } from './ui.jsx';
import { cacheGet, swrFetch } from './cache.js';
import GlobalSearch from './GlobalSearch.jsx';
import { startPrefetch, warmRoute } from './prefetch.js';
import {
  ShoppingCart, Receipt, Users as UsersIcon, Package, Boxes, LayoutDashboard, Bell, PanelLeftClose, PanelLeftOpen,
  Clock, UserCog, ClipboardList, Truck, TrendingUp, Menu, X, ChevronDown, KeyRound, ShieldCheck, LogOut,
} from 'lucide-react';

// The menu: one list drives the sidebar, the page titles and the top-bar search.
const NAV = [
  { group: 'Main', items: [
    { to: '/dashboard', label: 'Dashboard', sub: "Your business at a glance", icon: LayoutDashboard, owner: true },
    { to: '/', label: 'Sell', sub: 'Create a new sale', icon: ShoppingCart },
  ] },
  { group: 'Sales', items: [
    { to: '/sales', label: 'Sales', sub: 'Browse and manage transactions', icon: Receipt },
    { to: '/customers', label: 'Customers', sub: 'Accounts, credit and statements', icon: UsersIcon },
  ] },
  { group: 'Inventory', owner: true, items: [
    { to: '/products', label: 'Products', sub: 'Catalogue, prices and images', icon: Package },
    { to: '/stock', label: 'Stock', sub: 'Receive, adjust and take stock', icon: Boxes },
    { to: '/suppliers', label: 'Suppliers', sub: 'Manage your suppliers', icon: Truck },
  ] },
  { group: 'Management', owner: true, items: [
    { to: '/reports', label: 'Reports', sub: 'Sales performance and stock value', icon: TrendingUp },
    { to: '/shifts', label: 'Shifts', sub: 'Open and close cash register shifts', icon: Clock },
    { to: '/users', label: 'Users', sub: 'Staff accounts and permissions', icon: UserCog },
    { to: '/audit', label: 'Audit log', sub: 'Every change made in the system', icon: ClipboardList },
  ] },
];
const visibleNav = (isOwner) => NAV.filter((g) => isOwner || !g.owner)
  .map((g) => ({ ...g, items: g.items.filter((i) => isOwner || !i.owner) })).filter((g) => g.items.length);
const pageOf = (pathname) => NAV.flatMap((g) => g.items).find((i) => i.to === pathname);

const readPref = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

// Low and out-of-stock products (owners): a count on the bell, the list in its menu.
function StockBell() {
  const [list, setList] = useState(() => cacheGet('/products?all=1&q='));
  const [open, setOpen] = useState(false);
  useEffect(() => { swrFetch('/products?all=1&q=', { onData: setList, ttlMs: 60_000 }).catch(() => {}); }, []);
  const low = (list || []).filter((p) => p.active && p.stock <= p.reorderLevel).sort((a, b) => a.stock - b.stock);
  return (
    <div className="topbar-user-wrap">
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={`Low stock: ${low.length}`} aria-expanded={open}>
        <Bell size={18} />{low.length > 0 && <span className="icon-badge">{low.length > 99 ? '99+' : low.length}</span>}
      </button>
      {open && (
        <>
          <div className="topbar-backdrop" onClick={() => setOpen(false)} />
          <div className="topbar-dropdown bell-pop">
            <div className="bell-head"><strong>Low stock</strong><span>{low.length} product{low.length === 1 ? '' : 's'}</span></div>
            {low.length === 0 && <p className="bell-empty">Everything is above its reorder level.</p>}
            {low.slice(0, 8).map((p) => (
              <div key={p._id} className="bell-row">
                <span>{productLabel(p)}</span>
                <span className={p.stock <= 0 ? 'out' : 'low'}>{p.stock <= 0 ? 'Out' : `${qtyFmt(p.stock)} left`}</span>
              </div>
            ))}
            {low.length > 0 && <Link className="bell-more" to="/stock" onClick={() => setOpen(false)}>Restock in Stock →</Link>}
          </div>
        </>
      )}
    </div>
  );
}

function Topbar({ user, onQueue, logout, onMenu, onCollapse, collapsed, onChangePassword, onRecovery, recoveryAlert }) {
  const { pathname } = useLocation();
  const { online } = useOfflineSync();
  const { isOwner } = useAuth();
  const page = pageOf(pathname);
  const [open, setOpen] = useState(false);
  const pages = visibleNav(isOwner).flatMap((g) => g.items);
  return (
    <header className="topbar">
      <button className="topbar-menu" onClick={onMenu} aria-label="Open menu"><Menu size={22} /></button>
      <button className="icon-btn collapse-btn" onClick={onCollapse} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <span className="topbar-title">{page?.label ?? 'Posify'}</span>
      <GlobalSearch pages={pages} isOwner={isOwner} />
      <div className="topbar-right">
        <span className={`topbar-status ${online ? 'online' : 'offline'}`} title={online ? 'Online' : 'Offline: sales are saved and sent later'}>
          <span className="status-dot" /><span className="status-text">{online ? 'Online' : 'Offline'}</span>
        </span>
        <QueueBadge onClick={onQueue} />
        {isOwner && <StockBell />}
        {pathname !== '/' && <Link to="/" className="btn-sell"><ShoppingCart size={16} /> <span>Sell</span></Link>}
        <div className="topbar-user-wrap">
          <button className="topbar-user" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu">
            <span className="topbar-avatar">{user.name.charAt(0).toUpperCase()}</span>
            <span className="topbar-user-text"><strong>{user.name}</strong><small>{isOwner ? 'Owner' : 'Cashier'}</small></span>
            <ChevronDown size={14} className="topbar-chevron" />
          </button>
          {open && (
            <>
              <div className="topbar-backdrop" onClick={() => setOpen(false)} />
              <div className="topbar-dropdown">
                <div className="topbar-dropdown-user">
                  <span className="topbar-avatar lg">{user.name.charAt(0).toUpperCase()}</span>
                  <div>
                    <div className="topbar-dropdown-name">{user.name}</div>
                    <div className="topbar-dropdown-role">{isOwner ? 'Owner' : 'Cashier'}</div>
                  </div>
                </div>
                <hr className="topbar-dropdown-divider" />
                <button className="topbar-dropdown-item" onClick={() => { setOpen(false); onChangePassword(); }}><KeyRound size={15} /> Change password</button>
                {isOwner && (
                  <button className="topbar-dropdown-item" onClick={() => { setOpen(false); onRecovery(); }}>
                    <ShieldCheck size={15} /> Recovery codes{recoveryAlert && <span className="dot-alert" title="Set up or top up your recovery codes" />}
                  </button>
                )}
                <button className="topbar-dropdown-signout" onClick={() => { setOpen(false); logout(); }}><LogOut size={15} /> Sign out</button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// Title and description at the top of each page (the Sell screen keeps the full height for selling).
function PageHead() {
  const { pathname } = useLocation();
  const page = pageOf(pathname);
  if (!page || pathname === '/' || pathname === '/dashboard') return null; // these two have their own heading
  return (
    <div className="page-head">
      <h1>{page.label}</h1>
      <p>{page.sub}</p>
    </div>
  );
}

export default function App() {
  const { user, loading, logout, isOwner } = useAuth();
  const [showQueue, setShowQueue] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => readPref('pos_nav_collapsed')); // desktop: icons only
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recovery, refreshRecovery] = useRecoveryStatus(Boolean(user) && user.role === 'owner' && !user.mustChangePassword);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setNavOpen(false); }, [pathname]);
  // Owners start on the dashboard when they open the app; cashiers (and an offline till) start on Sell.
  const landed = useRef(false);
  useEffect(() => { if (!user) landed.current = false; }, [user]);
  useEffect(() => {
    if (!user || landed.current) return;
    landed.current = true;
    // Once per tab: a refresh on the Sell screen stays on Sell.
    let seen = false;
    try { seen = sessionStorage.getItem('pos_landed') === '1'; sessionStorage.setItem('pos_landed', '1'); } catch { /* private mode */ }
    if (!seen && user.role === 'owner' && !user.mustChangePassword && pathname === '/' && navigator.onLine) navigate('/dashboard', { replace: true });
  }, [user, pathname, navigate]);
  // Load the data every screen needs in the background, so each one opens instantly.
  const mustChange = Boolean(user?.mustChangePassword);
  useEffect(() => (user && !mustChange ? startPrefetch(isOwner) : undefined), [user, isOwner, mustChange]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setNavOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);
  if (loading) return <div className="boot">Loading…</div>;
  if (!user) return <Login />;
  if (mustChange) return <ForcePasswordChange />;

  const owner = (el) => (isOwner ? el : <Navigate to="/" replace />);
  const lazyPage = (el) => owner(<Suspense fallback={<div className="page"><TableSkeleton cols={4} rows={6} /></div>}>{el}</Suspense>);

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} />}
      <nav className={`side${navOpen ? ' open' : ''}`} aria-label="Main"
        onPointerOver={(e) => { const a = e.target.closest?.('a[href]'); if (a) warmRoute(a.getAttribute('href'), isOwner); }}
        onTouchStart={(e) => { const a = e.target.closest?.('a[href]'); if (a) warmRoute(a.getAttribute('href'), isOwner); }}>
        <button className="side-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={20} /></button>
        <div className="side-brand">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="side-logo">
            <rect width="32" height="32" rx="8" fill="#E3A62B" />
            <rect x="8" y="10" width="16" height="2.5" rx="1.25" fill="#17212B" />
            <rect x="8" y="15" width="16" height="2.5" rx="1.25" fill="#17212B" />
            <rect x="8" y="20" width="10" height="2.5" rx="1.25" fill="#17212B" />
          </svg>
          <span>{SHOP_NAME}</span>
        </div>

        <div className="side-scroll">
          {visibleNav(isOwner).map((g) => (
            <div className="nav-group" key={g.group}>
              <span className="nav-label">{g.group}</span>
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined}><Icon size={18} /> <span>{label}</span></NavLink>
              ))}
            </div>
          ))}
        </div>

        <div className="side-footer">
          <div className="side-avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div className="side-user-info">
            <span className="side-user-name">{user.name}</span>
            <span className="side-user-role">{isOwner ? 'Owner' : 'Cashier'}</span>
          </div>
        </div>
      </nav>

      <div className="shell-body">
        <Topbar user={user} onQueue={() => setShowQueue(true)} logout={logout} onMenu={() => setNavOpen(true)}
          collapsed={collapsed} onCollapse={() => setCollapsed((c) => { writePref('pos_nav_collapsed', !c); return !c; })}
          onChangePassword={() => setShowPassword(true)} onRecovery={() => setShowRecovery(true)} recoveryAlert={recoveryNeedsAttention(recovery)} />
        <main>
          <PageHead />
          <Routes>
            <Route path="/" element={<Sell />} />
            <Route path="/dashboard" element={lazyPage(<Dashboard />)} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/products" element={owner(<Products />)} />
            <Route path="/stock" element={owner(<Stock />)} />
            <Route path="/suppliers" element={owner(<Suppliers />)} />
            <Route path="/reports" element={lazyPage(<Reports />)} />
            <Route path="/shifts" element={owner(<Shifts />)} />
            <Route path="/users" element={owner(<Users />)} />
            <Route path="/audit" element={owner(<AuditLog />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {showQueue && <QueuePanel onClose={() => setShowQueue(false)} />}
      {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
      {showRecovery && <RecoveryCodesModal status={recovery} onChanged={refreshRecovery} onClose={() => { setShowRecovery(false); refreshRecovery(); }} />}
    </div>
  );
}
