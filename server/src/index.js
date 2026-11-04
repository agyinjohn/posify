import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { createApp } from './app.js';
import User from './models/User.js';
import { applyOwnerReset } from './lib/applyOwnerReset.js';
import Shop from './models/Shop.js';
import PlatformAdmin from './models/PlatformAdmin.js';
import { migrateToShops } from './lib/migrate.js';
import { checkPassword } from './lib/password.js';

await mongoose.connect(config.mongoUri);
console.log('MongoDB connected');

// Upgrade data from the single-shop version (does nothing once done). Must finish before requests are served.
await migrateToShops({ shopName: process.env.SHOP_NAME || 'My shop' });

// PLATFORM ADMIN: set ADMIN_USERNAME and ADMIN_PASSWORD (and optionally ADMIN_NAME) to create the first admin who
// manages shops at /admin. Remove ADMIN_PASSWORD from the environment once you have signed in.
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const username = process.env.ADMIN_USERNAME.toLowerCase().trim();
  if (await PlatformAdmin.exists({ username })) {
    console.log(`[admin] Admin "${username}" already exists. Remove ADMIN_PASSWORD from the environment.`);
  } else {
    checkPassword(process.env.ADMIN_PASSWORD, username);
    await PlatformAdmin.create({ name: process.env.ADMIN_NAME || 'Platform admin', username, passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12) });
    console.log(`[admin] Platform admin "${username}" created. Sign in at /admin, then remove ADMIN_PASSWORD from the environment.`);
  }
}

// AUTO-SEED (single shop, first boot only): with no shops at all, SEED_OWNER_PASSWORD creates one shop and its owner.
// New shops are normally created by the platform admin. Remove SEED_OWNER_PASSWORD after the first deploy.
if (process.env.SEED_OWNER_PASSWORD) {
  if (await Shop.exists({}) || await User.exists({ role: 'owner' }).setOptions({ skipTenant: true })) {
    console.log('[seed] A shop already exists — skipping.');
  } else {
    const shop = await Shop.create({ name: process.env.SHOP_NAME || 'My shop', ownerPasswordChangedAt: new Date() });
    const owner = await User.create({
      shop: shop._id,
      name: process.env.SEED_OWNER_NAME || 'Owner',
      username: process.env.SEED_OWNER_USERNAME || 'owner',
      passwordHash: await bcrypt.hash(process.env.SEED_OWNER_PASSWORD, 12),
      role: 'owner',
    });
    shop.owner = owner._id;
    await shop.save();
    console.log('[seed] Shop and owner account created. Remove SEED_OWNER_PASSWORD from env vars now.');
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
