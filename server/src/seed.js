import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import User from './models/User.js';

const password = process.env.SEED_OWNER_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set SEED_OWNER_PASSWORD (min 8 characters) in .env first.');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
if (await User.exists({ role: 'owner' })) {
  console.log('An owner account already exists. Nothing to do.');
} else {
  await User.create({
    name: process.env.SEED_OWNER_NAME || 'Owner',
    username: process.env.SEED_OWNER_USERNAME || 'owner',
    passwordHash: await bcrypt.hash(password, 12),
    role: 'owner',
  });
  console.log('Owner account created. Remove SEED_OWNER_PASSWORD from .env now.');
}
await mongoose.disconnect();
