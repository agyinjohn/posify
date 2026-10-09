import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
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
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'img-src': ["'self'", 'data:', 'https://res.cloudinary.com'] },
    },
  }));
  app.use(cors({ origin: config.clientOrigins }));
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
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
