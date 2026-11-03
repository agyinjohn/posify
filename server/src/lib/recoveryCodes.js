import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * One-time recovery codes for the owner account. They are the proof of identity for the login page's
 * "Forgot password?" screen. Each is 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
 * about 50 bits, shown once and stored only as bcrypt hashes.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 symbols
export const CODE_COUNT = 8;
const CODE_LENGTH = 10;
const HASH_ROUNDS = 10; // codes are long and random, so this is plenty and keeps verification quick

const randomCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

export const formatCode = (raw) => `${raw.slice(0, 5)}-${raw.slice(5)}`;

// Typed codes: ignore case, spaces and dashes (so "abcde fghjk" and "ABCDE-FGHJK" are the same code).
export const normalizeCode = (input) => String(input ?? '').toUpperCase().replace(/[\s-]/g, '').slice(0, 64);

export const looksLikeCode = (input) => {
  const n = normalizeCode(input);
  return n.length === CODE_LENGTH && [...n].every((c) => ALPHABET.includes(c));
};

/** Fresh set: plain codes (show once) and the records to store. */
export async function generateCodes(count = CODE_COUNT) {
  const codes = new Set();
  while (codes.size < count) codes.add(randomCode());
  const raw = [...codes];
  const records = await Promise.all(raw.map(async (c) => ({ hash: await bcrypt.hash(c, HASH_ROUNDS), usedAt: null })));
  return { codes: raw.map(formatCode), records };
}

/** Index of the unused record that matches the typed code, or -1. Always does at least one hash comparison. */
export async function findCode(records, input) {
  const code = normalizeCode(input);
  if (code.length !== CODE_LENGTH) { await bcrypt.compare('x', DUMMY); return -1; }
  let found = -1;
  for (let i = 0; i < records.length; i += 1) {
    if (records[i].usedAt) continue;
    if (await bcrypt.compare(code, records[i].hash)) { found = i; break; }
  }
  if (found === -1 && records.every((r) => r.usedAt)) await bcrypt.compare('x', DUMMY);
  return found;
}
const DUMMY = bcrypt.hashSync('not-a-recovery-code', HASH_ROUNDS);

export const remaining = (records = []) => records.filter((r) => !r.usedAt).length;

/** Remembers recent failures per key (the submitted username) and locks it for a while. In memory, per server. */
export class FailureTracker {
  constructor({ limit = 5, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
    this.limit = limit; this.windowMs = windowMs; this.now = now; this.map = new Map();
  }
  isLocked(key) {
    const e = this.map.get(key);
    if (!e) return false;
    if (this.now() - e.first > this.windowMs) { this.map.delete(key); return false; }
    return e.count >= this.limit;
  }
  fail(key) {
    const t = this.now();
    const e = this.map.get(key);
    if (!e || t - e.first > this.windowMs) this.map.set(key, { count: 1, first: t });
    else e.count += 1;
    if (this.map.size > 5000) this.map.clear();
  }
  clear(key) { this.map.delete(key); }
}
