import test from 'node:test';
import assert from 'node:assert/strict';
import { statusLine } from '../src/lib/migrate.js';

test('start-up status line: all good', () => {
  assert.equal(statusLine({ shops: 1, active: 1, missing: { Product: 0, Sale: 0 } }), '[migrate] Status: 1 shop (1 active); every record belongs to a shop.');
  assert.equal(statusLine({ shops: 3, active: 2, missing: {} }), '[migrate] Status: 3 shops (2 active); every record belongs to a shop.');
});

test('start-up status line: records left without a shop are named', () => {
  assert.equal(
    statusLine({ shops: 1, active: 1, missing: { Product: 3, Sale: 0, User: 1 } }),
    '[migrate] Status: 1 shop (1 active); WARNING: 4 records still without a shop: Product 3, User 1',
  );
});
