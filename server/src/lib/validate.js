import mongoose from 'mongoose';
import { SaleError } from './pricing.js';

export const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj && obj[k] !== undefined).map((k) => [k, obj[k]]));

export const assertId = (id, label = 'id') => {
  if (!mongoose.isValidObjectId(id)) throw new SaleError(`Invalid ${label}`);
};

export const num = (v, label, { min = 0, max = 1e9, allowZero = true } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (!allowZero && n === 0)) throw new SaleError(`${label} is not valid`);
  return n;
};

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// YYYY-MM-DD -> UTC day range (Ghana runs on GMT year-round, so UTC days match local days).
export const dayRange = (from, to) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toISOString().slice(0, 10);
  const f = typeof from === 'string' && re.test(from) ? from : today;
  const t = typeof to === 'string' && re.test(to) ? to : f;
  const start = new Date(`${f}T00:00:00.000Z`);
  const end = new Date(new Date(`${t}T00:00:00.000Z`).getTime() + 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new SaleError('Invalid date range');
  if (end - start > 366 * 86_400_000) throw new SaleError('Date range is too long (max 1 year)');
  return { start, end, from: f, to: t };
};
