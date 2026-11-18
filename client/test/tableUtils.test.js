import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTable, compareValues, pageList, exportRows } from '../src/tableUtils.js';

const columns = [{ key: 'name', label: 'Name' }, { key: 'price', label: 'Price' }, { key: 'sku', label: 'SKU', value: (r) => r.sku }, { key: 'img', label: '', export: false }];
const rows = [
  { name: 'Rice 5kg', price: 125, sku: 'R10', cat: 'Grains' },
  { name: 'Rice 25kg', price: 560, sku: 'R2', cat: 'Grains' },
  { name: 'Milo', price: 52, sku: 'M1', cat: 'Drinks' },
  { name: 'Tissue', price: null, sku: 'T1', cat: 'Household' },
];

test('search matches every word, filters narrow, sorting is numeric-aware with blanks last', () => {
  assert.deepEqual(applyTable(rows, { columns, search: 'rice 25kg' }).rows.map((r) => r.name), ['Rice 25kg']);
  const filters = [{ key: 'cat', test: (r, v) => r.cat === v }];
  assert.equal(applyTable(rows, { columns, filters, values: { cat: 'Grains' } }).total, 2);
  assert.equal(applyTable(rows, { columns, filters, values: { cat: '' } }).total, 4);
  assert.deepEqual(applyTable(rows, { columns, sort: { key: 'price', dir: 'asc' } }).rows.map((r) => r.price), [52, 125, 560, null]);
  assert.deepEqual(applyTable(rows, { columns, sort: { key: 'price', dir: 'desc' } }).rows.map((r) => r.price), [560, 125, 52, null]);
  assert.deepEqual(applyTable(rows, { columns, sort: { key: 'sku', dir: 'asc' } }).rows.map((r) => r.sku), ['M1', 'R2', 'R10', 'T1']);
  assert.ok(compareValues('2026-11-02', '2026-11-10') < 0);
});

test('paging: counts, clamping and the page buttons', () => {
  const many = Array.from({ length: 53 }, (_, i) => ({ name: `P${i}` }));
  const t = applyTable(many, { columns, page: 3, pageSize: 25 });
  assert.deepEqual([t.pages, t.page, t.from, t.to, t.pageRows.length], [3, 3, 51, 53, 3]);
  assert.equal(applyTable(many, { columns, page: 9, pageSize: 25 }).page, 3);
  assert.equal(applyTable(many, { columns, pageSize: 'all' }).pageRows.length, 53);
  assert.deepEqual(applyTable([], { columns }).from, 0);
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(pageList(2, 4), [1, 2, 3, 4]);
});

test('export uses labels, skips columns marked export:false, and prefers exportValue', () => {
  const out = exportRows([...columns, { key: 'cat', label: 'Category', exportValue: (r) => r.cat.toUpperCase() }], rows.slice(0, 1));
  assert.deepEqual(out, [['Name', 'Price', 'SKU', 'Category'], ['Rice 5kg', 125, 'R10', 'GRAINS']]);
  assert.deepEqual(exportRows([{ key: 'user', label: 'By' }], [{ user: { name: 'Ama' } }]), [['By'], ['Ama']]);
});
