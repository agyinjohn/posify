import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from './config.js';
import { sanitize } from './middleware/sanitize.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import productRoutes from './routes/products.js';
import stockRoutes from './routes/stock.js';
import customerRoutes from './routes/customers.js';
import saleRoutes from './routes/sales.js';
import reportRoutes from './routes/reports.js';
import heldSaleRoutes from './routes/held-sales.js';
import auditRoutes from './routes/audit.js';
import shiftRoutes from './routes/shifts.js';
import supplierRoutes from './routes/suppliers.js';
import purchaseOrderRoutes from './routes/purchase-orders.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'img-src': ["'self'", 'data:', 'https://res.cloudinary.com'] },
    },
  }));
  app.use(compression()); // JSON lists (products, sales) shrink about 5x, which is most of the wait on mobile data
  app.use(cors({ origin: config.clientOrigins }));
  // A product import carries a whole spreadsheet (up to 2000 rows); everything else stays small.
  app.use('/api/products/import', express.json({ limit: '3mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(sanitize);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/sales', saleRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/held-sales', heldSaleRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/shifts', shiftRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/purchase-orders', purchaseOrderRoutes);
  app.use('/api', notFound);

  // One-deploy setup: serve the built React app from the same server when it exists.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    // Built files have hashed names, so browsers can keep them for a year; index.html must always be re-checked.
    app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(dist, { maxAge: 0, etag: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
