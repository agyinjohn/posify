import 'dotenv/config';

const need = (key) => {
  if (!process.env[key]) throw new Error(`Missing required env var ${key}`);
  return process.env[key];
};

const cloud = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
};

export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: need('MONGODB_URI'),
  jwtSecret: need('JWT_SECRET'),
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  maxCashierDiscountPct: Number(process.env.MAX_CASHIER_DISCOUNT_PCT ?? 10),
  cloudinary: cloud,
  cloudinaryEnabled: Boolean(cloud.cloud_name && cloud.api_key && cloud.api_secret),
};

if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
