import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword, tokenRevoked } from '../src/lib/password.js';
import { pickOwner, resetFingerprint } from '../src/lib/ownerReset.js';
import { SaleError } from '../src/lib/pricing.js';

test('password rules', () => {
  assert.doesNotThrow(() => checkPassword('river-stone-42', 'ama'));
  assert.throws(() => checkPassword('short', 'ama'), SaleError);
  assert.throws(() => checkPassword(undefined, 'ama'), SaleError);
  assert.throws(() => checkPassword('Ama12345', 'ama12345'), SaleError); // same as username, any case
  assert.throws(() => checkPassword('password123', 'ama'), SaleError);
  assert.throws(() => checkPassword('aaaaaaaaaa', 'ama'), SaleError);
  assert.throws(() => checkPassword('x'.repeat(73), 'ama'), SaleError); // bcrypt would cut it off silently
  assert.throws(() => checkPassword('é'.repeat(40), 'ama'), SaleError); // 80 bytes
});

test('a token issued before a password change is rejected, later ones are not', () => {
  const changed = new Date('2026-01-01T12:00:30.700Z');
  const sec = Math.floor(changed.getTime() / 1000);
  assert.equal(tokenRevoked(sec - 1, changed), true);
  assert.equal(tokenRevoked(sec - 3600, changed), true);
  assert.equal(tokenRevoked(sec, changed), false);     // minted in the same second as the change, e.g. right after changing
  assert.equal(tokenRevoked(sec + 60, changed), false);
  assert.equal(tokenRevoked(sec - 3600, null), false); // never changed
  assert.equal(tokenRevoked(undefined, changed), true); // no issue time: predates the check
});

const owner = (username) => ({ username, role: 'owner' });
test('owner recovery picks the only owner, or the named one, never guesses', () => {
  assert.equal(pickOwner([owner('kofi')], undefined).username, 'kofi');
  assert.equal(pickOwner([owner('kofi'), owner('ama')], ' AMA ').username, 'ama');
  assert.throws(() => pickOwner([owner('kofi'), owner('ama')], undefined), /choose one/);
  assert.throws(() => pickOwner([owner('kofi')], 'nobody'), /No owner account named/);
  assert.throws(() => pickOwner([], undefined), SaleError);
});

test('the reset fingerprint is stable per value and differs between values and secrets', () => {
  const a = resetFingerprint('temp-pass-1', 'secret-one');
  assert.equal(a, resetFingerprint('temp-pass-1', 'secret-one'));
  assert.notEqual(a, resetFingerprint('temp-pass-2', 'secret-one'));
  assert.notEqual(a, resetFingerprint('temp-pass-1', 'secret-two'));
  assert.ok(!a.includes('temp-pass-1'));
});
