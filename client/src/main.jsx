import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/public-sans/800.css';
import './styles.css';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastProvider } from './ui.jsx';
import { startResponsiveTables } from './responsiveTables.js';

// The platform admin (creating and suspending shops) is a separate app at /admin, loaded only there.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));
const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

createRoot(document.getElementById('root')).render(isAdmin ? (
  <React.StrictMode>
    <ToastProvider>
      <Suspense fallback={<div className="boot">Loading…</div>}><AdminApp /></Suspense>
    </ToastProvider>
  </React.StrictMode>
) : (
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
));

startResponsiveTables();
