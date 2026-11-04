import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceUnitPrice, packSpecificPrice, packPriceFor, lineGross, toPiecePrice, toPackPrice, toPieces, toPacks, breakdown, unitsOf, hasPack, packName } from '../src/bulk.js';

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

const carton = (over = {}) => ({ unitsPerPack: 12, packLabel: 'ctn', retailPrice: 12, wholesalePrice: 0, packRetailPrice: 0, packWholesalePrice: 0, ...over });

test('single pieces pay the piece price, a full pack pays the pack price', () => {
  assert.equal(lineGross(carton({ packRetailPrice: 100 }), 'pack', 1), 100);
  assert.equal(lineGross(carton({ packRetailPrice: 100 }), 'pack', 2), 200);
  assert.equal(lineGross(carton({ packRetailPrice: 100 }), 'piece', 12), 144);
  assert.equal(lineGross(carton(), 'pack', 1), 144);              // no pack price: 12 x 12
  assert.equal(packSpecificPrice(carton(), 'retail'), null);
  assert.equal(packPriceFor(carton()), 144);
  assert.equal(packPriceFor(carton({ packRetailPrice: 100 })), 100);
});

test('products saved before keep their old wholesale carton pricing', () => {
  assert.equal(packPriceFor(carton({ packRetailPrice: 120, packWholesalePrice: 100 })), 100);
  assert.equal(packPriceFor(carton({ wholesalePrice: 9 })), 108);
  assert.equal(pieceUnitPrice(carton({ wholesalePrice: 9 })), 12); // pieces always at the piece price
});

test('a product with no pack size ignores pack prices', () => {
  const p = { unitsPerPack: 1, retailPrice: 60, packRetailPrice: 5 };
  assert.equal(packSpecificPrice(p), null);
  assert.equal(lineGross(p, 'pack', 2), 120);
});
