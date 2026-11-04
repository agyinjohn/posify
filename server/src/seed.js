import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import User from './models/User.js';
import Shop from './models/Shop.js';

const password = process.env.SEED_OWNER_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set SEED_OWNER_PASSWORD (min 8 characters) in .env first.');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
// Creates the first shop and its owner. Further shops are created by the platform admin at /admin.
if (await Shop.exists({}) || await User.exists({ role: 'owner' }).setOptions({ skipTenant: true })) {
  console.log('A shop already exists. Nothing to do.');
} else {
  const shop = await Shop.create({ name: process.env.SHOP_NAME || 'My shop', ownerPasswordChangedAt: new Date() });
  const owner = await User.create({
    shop: shop._id,
    name: process.env.SEED_OWNER_NAME || 'Owner',
    username: process.env.SEED_OWNER_USERNAME || 'owner',
    passwordHash: await bcrypt.hash(password, 12),
    role: 'owner',
  });
  shop.owner = owner._id;
  await shop.save();
  console.log('Shop and owner account created. Remove SEED_OWNER_PASSWORD from .env now.');
}
await mongoose.disconnect();
