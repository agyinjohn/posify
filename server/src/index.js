import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { createApp } from './app.js';
import User from './models/User.js';

await mongoose.connect(config.mongoUri);
console.log('MongoDB connected');

// AUTO-SEED: creates the owner account on first boot if SEED_OWNER_PASSWORD is set.
// Remove SEED_OWNER_PASSWORD from env vars after the first successful deploy.
if (process.env.SEED_OWNER_PASSWORD) {
  if (await User.exists({ role: 'owner' })) {
    console.log('[seed] Owner already exists — skipping.');
  } else {
    await User.create({
      name: process.env.SEED_OWNER_NAME || 'Owner',
      username: process.env.SEED_OWNER_USERNAME || 'owner',
      passwordHash: await bcrypt.hash(process.env.SEED_OWNER_PASSWORD, 12),
      role: 'owner',
    });
    console.log('[seed] Owner account created. Remove SEED_OWNER_PASSWORD from env vars now.');
  }
}

const server = createApp().listen(config.port, () => console.log(`POS server on http://localhost:${config.port}`));

// Log stray promise errors instead of dying silently, and finish in-flight requests on shutdown.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection', err));
const shutdown = () => server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
