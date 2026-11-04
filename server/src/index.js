import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { createApp } from './app.js';
import User from './models/User.js';
import { applyOwnerReset } from './lib/applyOwnerReset.js';

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

// OWNER RECOVERY (no terminal needed, e.g. on Render): set RESET_OWNER_PASSWORD on the host and restart.
// It is applied once per value; afterwards delete the variable. See README, "Forgot the owner password".
if (process.env.RESET_OWNER_PASSWORD) {
  try {
    const r = await applyOwnerReset({ password: process.env.RESET_OWNER_PASSWORD, username: process.env.RESET_OWNER_USERNAME, secret: config.jwtSecret });
    if (r.status === 'reset') console.warn(`[reset] Password of owner "${r.username}" was reset to RESET_OWNER_PASSWORD. They must choose a new one at sign-in. REMOVE RESET_OWNER_PASSWORD from the environment now.`);
    else console.warn('[reset] RESET_OWNER_PASSWORD is still set but was already applied. Remove it from the environment.');
  } catch (err) {
    console.error(`[reset] Owner password NOT reset: ${err.message}`);
  }
}

const server = createApp().listen(config.port, () => console.log(`POS server on http://localhost:${config.port}`));

// Log stray promise errors instead of dying silently, and finish in-flight requests on shutdown.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection', err));
const shutdown = () => server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
