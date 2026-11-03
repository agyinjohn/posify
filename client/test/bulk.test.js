import test from 'node:test';
import assert from 'node:assert/strict';
import { toPiecePrice, toPackPrice, toPieces, toPacks, breakdown, unitsOf, hasPack, packName } from '../src/bulk.js';

test('carton prices convert to per-piece and back', () => {
  assert.equal(toPiecePrice(120, 12), 10);
  assert.equal(toPackPrice(10, 12), 120);
  assert.equal(toPiecePrice(50, 1), 50); // no pack: unchanged
});

test('an awkward pack size keeps enough precision that a full pack totals exactly', () => {
  const perPiece = toPiecePrice(120, 7); // 17.142857
  assert.equal(Math.round(perPiece * 7 * 100) / 100, 120);
  assert.equal(toPackPrice(perPiece, 7), 120);
});

test('quantities convert between packs and pieces', () => {
  assert.equal(toPieces(5, 12), 60);
  assert.equal(toPieces(0.5, 12), 6);
  assert.equal(toPacks(60, 12), 5);
});

test('unit helpers', () => {
  assert.equal(unitsOf({ unitsPerPack: 12 }), 12);
  assert.equal(unitsOf({}), 1);
  assert.equal(unitsOf({ unitsPerPack: 0 }), 1);
  assert.equal(hasPack({ unitsPerPack: 1 }), false);
  assert.equal(hasPack({ unitsPerPack: 6 }), true);
  assert.equal(packName({ packLabel: ' ctn ' }), 'ctn');
  assert.equal(packName({}), 'pack');
});

test('breakdown shows whole packs and loose pieces', () => {
  const p = { unitsPerPack: 12, packLabel: 'ctn' };
  assert.equal(breakdown(27, p), '2 ctn + 3 pcs');
  assert.equal(breakdown(24, p), '2 ctn');
  assert.equal(breakdown(5, p), '5 pcs');
  assert.equal(breakdown(7, { unitsPerPack: 1 }), '7');
});
