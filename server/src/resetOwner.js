// Usage:  RESET_OWNER_PASSWORD='temporary-password' npm run reset-owner
//         (or just `npm run reset-owner` and type it when asked)
// Optional: RESET_OWNER_USERNAME=owner   (only needed when there is more than one owner)
import readline from 'node:readline';
import mongoose from 'mongoose';
import { config } from './config.js';
import { applyOwnerReset } from './lib/applyOwnerReset.js';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); }; // do not echo what is typed
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const password = process.env.RESET_OWNER_PASSWORD || (await askHidden('New temporary owner password (8+ characters): '));
await mongoose.connect(config.mongoUri);
try {
  const r = await applyOwnerReset({ password, username: process.env.RESET_OWNER_USERNAME, secret: config.jwtSecret, skipIfApplied: false });
  console.log(`Owner "${r.username}" now has the temporary password you entered. They must choose a new one at the next sign-in, and every existing session was signed out.`);
} catch (err) {
  console.error(`Not reset: ${err.message}`);
  process.exitCode = 1;
}
await mongoose.disconnect();
