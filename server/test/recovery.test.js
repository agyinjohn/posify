import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCodes, findCode, normalizeCode, looksLikeCode, remaining, FailureTracker, CODE_COUNT } from '../src/lib/recoveryCodes.js';

test('a fresh set has 8 distinct, well-formed codes and only hashes are kept', async () => {
  const { codes, records } = await generateCodes();
  assert.equal(codes.length, CODE_COUNT);
  assert.equal(new Set(codes).size, CODE_COUNT);
  for (const c of codes) assert.match(c, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/); // no 0 O 1 I L
  assert.equal(records.length, CODE_COUNT);
  assert.ok(records.every((r) => r.usedAt === null && r.hash.startsWith('$2') && !codes.includes(r.hash)));
  assert.equal(remaining(records), CODE_COUNT);
});

test('typed codes match regardless of case, spaces and dashes', async () => {
  const { codes, records } = await generateCodes(3);
  const c = codes[1];
  assert.equal(await findCode(records, c), 1);
  assert.equal(await findCode(records, c.toLowerCase()), 1);
  assert.equal(await findCode(records, c.replace('-', ' ')), 1);
  assert.equal(await findCode(records, `  ${c.replace('-', '')}  `), 1);
  assert.equal(normalizeCode('abcde fghjk'), 'ABCDEFGHJK');
  assert.equal(looksLikeCode(c), true);
  assert.equal(looksLikeCode('too-short'), false);
});

test('wrong, malformed and already used codes do not match', async () => {
  const { codes, records } = await generateCodes(3);
  assert.equal(await findCode(records, 'AAAAA-AAAAA'), -1);
  assert.equal(await findCode(records, ''), -1);
  assert.equal(await findCode(records, undefined), -1);
  assert.equal(await findCode(records, 'ABC'), -1);
  records[0].usedAt = new Date();
  assert.equal(await findCode(records, codes[0]), -1); // spent
  assert.equal(await findCode(records, codes[2]), 2);  // others still work
  assert.equal(remaining(records), 2);
});

test('failures lock a key after the limit, and expire', () => {
  let t = 0;
  const f = new FailureTracker({ limit: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 2; i += 1) f.fail('ama');
  assert.equal(f.isLocked('ama'), false);
  f.fail('ama');
  assert.equal(f.isLocked('ama'), true);
  assert.equal(f.isLocked('kofi'), false);
  t = 1500;
  assert.equal(f.isLocked('ama'), false); // window passed
  f.fail('ama'); f.clear('ama');
  assert.equal(f.isLocked('ama'), false);
});
