import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
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

export default function App() {
  const { user, loading, logout, isOwner } = useAuth();
  const [showQueue, setShowQueue] = useState(false);
  if (loading) return <div className="boot">Loading…</div>;
  if (!user) return <Login />;

  const links = [
    ['/', 'Sell', true],
    ['/sales', 'Sales', true],
    ['/customers', 'Customers', true],
    ['/products', 'Products', isOwner],
    ['/stock', 'Stock', isOwner],
    ['/suppliers', 'Suppliers', isOwner],
    ['/reports', 'Reports', isOwner],
    ['/shifts', 'Shifts', isOwner],
    ['/users', 'Users', isOwner],
    ['/audit', 'Audit log', isOwner],
  ].filter((l) => l[2]);
  const owner = (el) => (isOwner ? el : <Navigate to="/" replace />);

  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">{SHOP_NAME}</div>
        {links.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
        <div className="who">
          <QueueBadge onClick={() => setShowQueue(true)} />
          <span>{user.name}</span>
          <button className="ghost" onClick={logout}>Sign out</button>
        </div>
      </nav>
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
      {showQueue && <QueuePanel onClose={() => setShowQueue(false)} />}
    </div>
  );
}
