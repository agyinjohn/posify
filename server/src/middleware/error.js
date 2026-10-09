import { SaleError } from '../lib/pricing.js';

export const notFound = (_req, res) => res.status(404).json({ error: 'Not found' });

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof SaleError) return res.status(err.status).json({ error: err.message });
  if (err.name === 'ValidationError') {
    const msg = Object.values(err.errors).map((e) => e.message).join('. ');
    return res.status(400).json({ error: msg });
  }
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid value' });
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ error: `That ${field} is already in use` });
  }
  if (err.name === 'MulterError') return res.status(400).json({ error: err.message });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
};
