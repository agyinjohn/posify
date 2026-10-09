import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';

await mongoose.connect(config.mongoUri);
console.log('MongoDB connected');
createApp().listen(config.port, () => console.log(`POS server on http://localhost:${config.port}`));
