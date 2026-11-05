import test from 'node:test';
import assert from 'node:assert/strict';
import { statusLine, legacyUniqueIndexes } from '../src/lib/migrate.js';

test('start-up status line: all good', () => {
  assert.equal(statusLine({ shops: 1, active: 1, missing: { Product: 0, Sale: 0 } }), '[migrate] Status: 1 shop (1 active); every record belongs to a shop; unique rules are per shop.');
  assert.equal(statusLine({ shops: 3, active: 2, missing: {} }), '[migrate] Status: 3 shops (2 active); every record belongs to a shop; unique rules are per shop.');
});

test('start-up status line: records left without a shop are named', () => {
  assert.equal(
    statusLine({ shops: 1, active: 1, missing: { Product: 3, Sale: 0, User: 1 } }),
    '[migrate] Status: 1 shop (1 active); WARNING: 4 records still without a shop: Product 3, User 1',
  );
});

test('start-up status line: old shop-wide unique rules are reported', () => {
  assert.equal(
    statusLine({ shops: 2, active: 2, missing: {}, legacyLeft: 1 }),
    '[migrate] Status: 2 shops (2 active); every record belongs to a shop; WARNING: 1 old shop-wide unique rule still in place (see errors above).',
  );
});

test('old shop-wide unique indexes are found; per-shop and schema ones are kept', () => {
  const productSchemaIndexes = [[{ shop: 1, sku: 1 }, { unique: true }], [{ shop: 1, barcode: 1 }, { unique: true }], [{ shop: 1 }, {}]];
  const db = [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'sku_1', key: { sku: 1 }, unique: true },
    { name: 'barcode_1', key: { barcode: 1 }, unique: true, partialFilterExpression: { barcode: { $type: 'string' } } },
    { name: 'shop_1_sku_1', key: { shop: 1, sku: 1 }, unique: true },
    { name: 'active_1_name_1', key: { active: 1, name: 1 } }, // not unique: harmless, left to syncIndexes
  ];
  assert.deepEqual(legacyUniqueIndexes(db, productSchemaIndexes).map((i) => i.name), ['sku_1', 'barcode_1']);
  // users: username stays unique across all shops on purpose (sign-in finds the shop from it)
  const userDb = [{ name: 'username_1', key: { username: 1 }, unique: true }];
  assert.deepEqual(legacyUniqueIndexes(userDb, [[{ username: 1 }, { unique: true, background: true }]]), []);
  // sales: old receipt number rule
  assert.deepEqual(legacyUniqueIndexes([{ name: 'receiptNo_1', key: { receiptNo: 1 }, unique: true }], [[{ shop: 1, receiptNo: 1 }, { unique: true }]]).map((i) => i.name), ['receiptNo_1']);
});
