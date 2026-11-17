import test from 'node:test';
import assert from 'node:assert/strict';
import { groupProducts, findVariant, stockFor, compareSizes } from '../src/variants.js';

const v = (id, size, color, stock, price = 150, extra = {}) => ({ _id: id, name: 'Kente Dress', size, color, stock, retailPrice: price, category: 'Dresses', ...extra });

test('sizes sort small to large, numbers by value', () => {
  assert.deepEqual(['XL', 'S', 'M', 'XS', 'L'].sort(compareSizes), ['XS', 'S', 'M', 'L', 'XL']);
  assert.deepEqual(['42', '38', '40.5'].sort(compareSizes), ['38', '40.5', '42']);
});

test('products sharing a name with sizes/colours become one style; plain products stay as they are', () => {
  const items = groupProducts([
    { _id: 'r', name: 'Rice', stock: 5, retailPrice: 10 },
    v('a', 'L', 'Red', 2), v('b', 'M', 'Red', 0), v('c', 'M', 'Blue', 4, 170, { image: { url: 'x.jpg' } }),
    { _id: 'k', name: 'kente dress ', size: 'S', color: 'Red', stock: 1, retailPrice: 150 },
  ]);
  assert.deepEqual(items.map((i) => i.type), ['product', 'style']);
  const s = items[1];
  assert.deepEqual(s.sizes, ['S', 'M', 'L']);
  assert.deepEqual(s.colors, ['Blue', 'Red']);
  assert.equal(s.stock, 7);
  assert.deepEqual([s.minPrice, s.maxPrice], [150, 170]);
  assert.equal(s.image.url, 'x.jpg');
  assert.deepEqual(s.variants.map((x) => x._id), ['k', 'c', 'b', 'a']); // S, M Blue, M Red, L
  assert.equal(findVariant(s.variants, 'm', 'RED')._id, 'b');
  assert.equal(stockFor(s.variants, { size: 'M', color: null }), 4);
  assert.equal(stockFor(s.variants, { size: null, color: 'Red' }), 3);
});
