import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Sell from './pages/Sell.jsx';
import Sales from './pages/Sales.jsx';
import Customers from './pages/Customers.jsx';
import Products from './pages/Products.jsx';
import Stock from './pages/Stock.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Shifts from './pages/Shifts.jsx';
import Suppliers from './pages/Suppliers.jsx';
import { QueueBadge, QueuePanel } from './pages/OfflineQueue.jsx';
import { SHOP_NAME } from './format.js';
import { useOfflineSync } from './offlineSync.js';
import {
  ShoppingCart, Receipt, Users as UsersIcon, Package, BarChart2,
  Clock, UserCog, ClipboardList, Truck, TrendingUp,
} from 'lucide-react';

const PAGES = {
  '/':          { title: 'Sell',      sub: 'Create a new sale' },
  '/sales':     { title: 'Sales',     sub: 'Browse and manage transactions' },
  '/customers': { title: 'Customers', sub: 'Accounts, credit and statements' },
  '/products':  { title: 'Products',  sub: 'Catalogue, prices and images' },
  '/stock':     { title: 'Stock',     sub: 'Receive, adjust and take stock' },
  '/suppliers': { title: 'Suppliers', sub: 'Manage your suppliers' },
  '/reports':   { title: 'Reports',   sub: 'Sales performance and stock value' },
  '/shifts':    { title: 'Shifts',    sub: 'Open and close cash register shifts' },
  '/users':     { title: 'Users',     sub: 'Cashier accounts and permissions' },
  '/audit':     { title: 'Audit Log', sub: 'Track every change made in the system' },
};

function Topbar({ user, onQueue, logout }) {
  const { pathname } = useLocation();
  const { online } = useOfflineSync();
  const { isOwner } = useAuth();
  const { title, sub } = PAGES[pathname] ?? { title: 'Posify', sub: '' };
  const [open, setOpen] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-titles">
        <span className="topbar-title">{title}</span>
        {sub && <span className="topbar-sub">{sub}</span>}
      </div>
      <div className="topbar-right">
        <span className={`topbar-status ${online ? 'online' : 'offline'}`}>
          <span className="status-dot" />{online ? 'Online' : 'Offline'}
        </span>
        <QueueBadge onClick={onQueue} />
        <div className="topbar-user-wrap">
          <button className="topbar-user" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <span className="topbar-avatar">{user.name.charAt(0).toUpperCase()}</span>
            <svg className="topbar-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
                <button className="topbar-dropdown-signout" onClick={() => { setOpen(false); logout(); }}>
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const { user, loading, logout, isOwner } = useAuth();
  const [showQueue, setShowQueue] = useState(false);
  if (loading) return <div className="boot">Loading…</div>;
  if (!user) return <Login />;

  const owner = (el) => (isOwner ? el : <Navigate to="/" replace />);

  return (
    <div className="shell">
      <nav className="side">
        <div className="side-brand">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="side-logo">
            <rect width="32" height="32" rx="8" fill="#E3A62B" />
            <rect x="8" y="10" width="16" height="2.5" rx="1.25" fill="#17212B" />
            <rect x="8" y="15" width="16" height="2.5" rx="1.25" fill="#17212B" />
            <rect x="8" y="20" width="10" height="2.5" rx="1.25" fill="#17212B" />
          </svg>
          <span>{SHOP_NAME}</span>
        </div>

        <div className="nav-group">
          <span className="nav-label">Sales</span>
          <NavLink to="/" end><ShoppingCart size={16} /> Sell</NavLink>
          <NavLink to="/sales"><Receipt size={16} /> Sales</NavLink>
          <NavLink to="/customers"><UsersIcon size={16} /> Customers</NavLink>
        </div>

        {isOwner && (
          <div className="nav-group">
            <span className="nav-label">Inventory</span>
            <NavLink to="/products"><Package size={16} /> Products</NavLink>
            <NavLink to="/stock"><BarChart2 size={16} /> Stock</NavLink>
            <NavLink to="/suppliers"><Truck size={16} /> Suppliers</NavLink>
          </div>
        )}

        {isOwner && (
          <div className="nav-group">
            <span className="nav-label">Management</span>
            <NavLink to="/reports"><TrendingUp size={16} /> Reports</NavLink>
            <NavLink to="/shifts"><Clock size={16} /> Shifts</NavLink>
            <NavLink to="/users"><UserCog size={16} /> Users</NavLink>
            <NavLink to="/audit"><ClipboardList size={16} /> Audit log</NavLink>
          </div>
        )}

        <div className="side-footer">
          <div className="side-avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div className="side-user-info">
            <span className="side-user-name">{user.name}</span>
            <span className="side-user-role">{isOwner ? 'Owner' : 'Cashier'}</span>
          </div>
        </div>
      </nav>

      <div className="shell-body">
        <Topbar user={user} onQueue={() => setShowQueue(true)} logout={logout} />
        <main>
          <Routes>
            <Route path="/" element={<Sell />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/products" element={owner(<Products />)} />
            <Route path="/stock" element={owner(<Stock />)} />
            <Route path="/suppliers" element={owner(<Suppliers />)} />
            <Route path="/reports" element={owner(<Reports />)} />
            <Route path="/shifts" element={owner(<Shifts />)} />
            <Route path="/users" element={owner(<Users />)} />
            <Route path="/audit" element={owner(<AuditLog />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {showQueue && <QueuePanel onClose={() => setShowQueue(false)} />}
    </div>
  );
}
