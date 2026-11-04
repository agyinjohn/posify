import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHeaders, parseNumber, normalizeRow, planImport, summarize, applyPlan, updateFields } from '../src/lib/productImport.js';

const headers = ['Product Name', 'SKU', 'Barcode', 'Category', 'Pieces per carton', 'Pack name', 'Cost (GH₵)', 'Cost per carton', 'Price', 'Carton price', 'Wholesale', 'Wholesale per carton', 'Opening stock', 'Stock cartons', 'Reorder level', 'Notes'];
const { map } = mapHeaders(headers);
const row = (cells) => normalizeRow(cells, map);
const mk = (o) => headers.map((h) => o[h] ?? '');

test('column titles are matched loosely and unknown ones are reported', () => {
  const m = mapHeaders(['NAME', 'Cost Per Carton', 'cost_per_ctn', 'Selling Price (GHS)', 'Qty', 'Colour']);
  assert.deepEqual(m.recognized.map((r) => r.field), ['name', 'costPack', 'retailPiece', 'stockPieces']); // second "cost per ctn" would be a duplicate of costPack
  assert.deepEqual(m.ignored, ['cost_per_ctn', 'Colour']);
  assert.equal(mapHeaders(['Cost (GH₵) per piece']).recognized[0].field, 'costPiece');
});

test('numbers: currency, thousands separators and comma decimals', () => {
  assert.equal(parseNumber('GH₵ 1,250.50'), 1250.5);
  assert.equal(parseNumber('1,250'), 1250);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('1.250,50'), 1250.5);
  assert.equal(parseNumber(' 7 '), 7);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(undefined), null);
  assert.ok(Number.isNaN(parseNumber('abc')));
});

test('a carton-only product: piece prices are worked out from the carton prices', () => {
  const r = row(mk({ 'Product Name': 'Frytol Oil', SKU: 'OIL', 'Pieces per carton': 12, 'Pack name': 'ctn', 'Cost per carton': 96, 'Carton price': 120, 'Wholesale per carton': 108, 'Stock cartons': 5 }));
  assert.deepEqual(r.errors, []);
  const d = r.data;
  assert.deepEqual([d.unitsPerPack, d.costPrice, d.retailPrice, d.wholesalePrice, d.packRetailPrice, d.packWholesalePrice, d.stock], [12, 8, 10, 9, 120, 108, 60]);
});

test('a carton price is kept as its own price next to a piece price', () => {
  const r = row(mk({ 'Product Name': 'Biscuit', SKU: 'B', 'Pieces per carton': 24, 'Cost (GH₵)': 1, Price: 2, 'Carton price': 40 }));
  assert.deepEqual([r.data.retailPrice, r.data.packRetailPrice], [2, 40]); // 24 x 2 = 48, but the carton sells for 40
});

test('piece-only product has no pack prices; pack columns without a pack size are ignored with a warning', () => {
  const ok = row(mk({ 'Product Name': 'Salt', SKU: 'S', 'Cost (GH₵)': 1, Price: 3 }));
  assert.deepEqual([ok.errors.length, ok.data.unitsPerPack, ok.data.packRetailPrice], [0, 1, 0]);
  const warn = row(mk({ 'Product Name': 'Salt', SKU: 'S', Price: 3, 'Cost (GH₵)': 1, 'Carton price': 30 }));
  assert.equal(warn.errors.length, 0);
  assert.ok(warn.warnings.some((w) => /Pack prices ignored/.test(w)));
  assert.equal(warn.data.packRetailPrice, 0);
  const bad = row(mk({ 'Product Name': 'Salt', SKU: 'S', Price: 3, 'Stock cartons': 2 }));
  assert.ok(bad.errors.some((e) => /packs needs/.test(e)));
});

test('row problems: missing name or price, bad numbers, negative values, fractional pack size', () => {
  assert.ok(row(mk({ SKU: 'X', Price: 5 })).errors.includes('Name is missing'));
  assert.ok(row(mk({ 'Product Name': 'A', SKU: 'X' })).errors.some((e) => /Selling price is missing/.test(e)));
  assert.ok(row(mk({ 'Product Name': 'A', Price: 'abc' })).errors.some((e) => /not a number/.test(e)));
  assert.ok(row(mk({ 'Product Name': 'A', Price: -3 })).errors.some((e) => /negative/.test(e)));
  assert.ok(row(mk({ 'Product Name': 'A', Price: 3, 'Pieces per carton': 2.5 })).errors.some((e) => /whole number/.test(e)));
});

test('no cost gives a warning (cost 0), not an error', () => {
  const r = row(mk({ 'Product Name': 'A', SKU: 'A', Price: 5 }));
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /No cost/.test(w)));
  assert.equal(r.data.costPrice, 0);
});

const prep = (cellsList) => cellsList.map((cells, i) => ({ row: i + 2, ...row(cells) }));
const none = new Map();

test('plan: creates, duplicate SKU in the file, generated SKUs, barcode clashes', () => {
  const rows = prep([
    mk({ 'Product Name': 'Rice', SKU: 'RICE', Price: 5, 'Cost (GH₵)': 3, Barcode: '111' }),
    mk({ 'Product Name': 'Rice again', SKU: 'RICE', Price: 5, 'Cost (GH₵)': 3 }),
    mk({ 'Product Name': 'Sugar 1kg', Price: 8, 'Cost (GH₵)': 6 }),               // no SKU
    mk({ 'Product Name': 'Sugar 1kg', Price: 8, 'Cost (GH₵)': 6 }),               // same name, still unique
    mk({ 'Product Name': 'Beans', SKU: 'BEANS', Price: 4, 'Cost (GH₵)': 2, Barcode: '111' }), // barcode used by RICE
    mk({ 'Product Name': '', Price: 4 }),
  ]);
  const plan = planImport({ rows, existingBySku: none, existingByBarcode: none, mode: 'skip' });
  assert.deepEqual(plan.map((e) => e.status), ['create', 'error', 'create', 'create', 'error', 'error']);
  assert.match(plan[1].errors[0], /Same SKU as row 2/);
  assert.equal(plan[2].sku, 'SUGAR-1KG');
  assert.equal(plan[3].sku, 'SUGAR-1KG-2');
  assert.ok(plan[2].generatedSku && plan[2].warnings.some((w) => /No SKU given/.test(w)));
  assert.match(plan[4].errors[0], /Barcode 111 is already used by RICE/);
  assert.deepEqual(summarize(plan), { total: 6, create: 3, update: 0, skip: 0, error: 3, warnings: 2 });
});

test('plan: existing SKUs are skipped or updated, and a barcode owned by another product is refused', () => {
  const existing = new Map([['RICE', { _id: 'id-rice', sku: 'RICE', barcode: '111' }], ['SALT', { _id: 'id-salt', sku: 'SALT' }]]);
  const byBarcode = new Map([['111', existing.get('RICE')]]);
  const rows = prep([
    mk({ 'Product Name': 'Rice', SKU: 'RICE', Price: 6, 'Cost (GH₵)': 3, 'Opening stock': 9 }),
    mk({ 'Product Name': 'Pepper', SKU: 'PEPPER', Price: 6, 'Cost (GH₵)': 3, Barcode: '111' }),
  ]);
  const skip = planImport({ rows, existingBySku: existing, existingByBarcode: byBarcode, mode: 'skip' });
  assert.deepEqual(skip.map((e) => e.status), ['skip', 'error']);
  const upd = planImport({ rows, existingBySku: existing, existingByBarcode: byBarcode, mode: 'update' });
  assert.equal(upd[0].status, 'update');
  assert.equal(upd[0].existingId, 'id-rice');
  assert.ok(upd[0].warnings.some((w) => /opening stock ignored/.test(w)));
  const set = updateFields(upd[0].data);
  assert.ok(!('stock' in set) && !('sku' in set));
  assert.equal(set.retailPrice, 6);
});

test('a generated SKU never collides with a product already in the shop', () => {
  const existing = new Map([['SUGAR-1KG', { _id: 'x', sku: 'SUGAR-1KG' }]]);
  const plan = planImport({ rows: prep([mk({ 'Product Name': 'Sugar 1kg', Price: 8, 'Cost (GH₵)': 6 })]), existingBySku: existing, existingByBarcode: none, mode: 'skip' });
  assert.equal(plan[0].sku, 'SUGAR-1KG-2');
  assert.equal(plan[0].status, 'create');
});

// ── applyPlan with fake models ──────────────────────────────────────────────────────────────
const fakeModels = ({ failIndexes = [], throwOther = false } = {}) => {
  const calls = { inserted: [], updated: [], moves: [] };
  return {
    calls,
    Product: {
      async bulkWrite(ops) {
        const isInsert = ops[0].insertOne;
        if (throwOther) throw new Error('connection lost');
        if (isInsert) calls.inserted.push(...ops.map((o) => o.insertOne.document)); else calls.updated.push(...ops.map((o) => o.updateOne));
        if (failIndexes.length) { const e = new Error('bulk'); e.writeErrors = failIndexes.map((index) => ({ index, code: 11000, errmsg: 'dup' })); throw e; }
      },
    },
    StockMovement: { async insertMany(m) { calls.moves.push(...m); } },
  };
};
let n = 0; const newId = () => `id${++n}`;

test('applyPlan inserts creates, writes opening-stock movements and updates existing', async () => {
  const rows = prep([
    mk({ 'Product Name': 'Rice', SKU: 'R', Price: 5, 'Cost (GH₵)': 3, 'Opening stock': 10 }),
    mk({ 'Product Name': 'Salt', SKU: 'S', Price: 2, 'Cost (GH₵)': 1 }),
    mk({ 'Product Name': 'Old', SKU: 'OLD', Price: 9, 'Cost (GH₵)': 4 }),
  ]);
  const plan = planImport({ rows, existingBySku: new Map([['OLD', { _id: 'old-id', sku: 'OLD' }]]), existingByBarcode: none, mode: 'update' });
  const m = fakeModels();
  const res = await applyPlan({ plan, ...m, userId: 'u1', newId });
  assert.deepEqual([...res.values()].map((r) => r.ok), [true, true, true]);
  assert.equal(m.calls.inserted.length, 2);
  assert.equal(m.calls.moves.length, 1);                       // only Rice has opening stock
  assert.deepEqual([m.calls.moves[0].type, m.calls.moves[0].qty, m.calls.moves[0].user], ['opening', 10, 'u1']);
  assert.equal(m.calls.moves[0].product, m.calls.inserted[0]._id);
  assert.equal(m.calls.updated[0].filter._id, 'old-id');
});

test('applyPlan reports rows the database rejected and only records stock for the ones that went in', async () => {
  const rows = prep([
    mk({ 'Product Name': 'A', SKU: 'A', Price: 5, 'Cost (GH₵)': 3, 'Opening stock': 4 }),
    mk({ 'Product Name': 'B', SKU: 'B', Price: 5, 'Cost (GH₵)': 3, 'Opening stock': 6 }),
  ]);
  const plan = planImport({ rows, existingBySku: none, existingByBarcode: none, mode: 'skip' });
  const m = fakeModels({ failIndexes: [1] });
  const res = await applyPlan({ plan, ...m, userId: 'u1', newId });
  assert.equal(res.get(2).ok, true);
  assert.equal(res.get(3).ok, false);
  assert.match(res.get(3).message, /already in use/);
  assert.deepEqual(m.calls.moves.map((x) => x.qty), [4]);       // B's stock is not recorded
});

test('applyPlan lets unexpected database errors surface', async () => {
  const plan = planImport({ rows: prep([mk({ 'Product Name': 'A', SKU: 'A', Price: 5, 'Cost (GH₵)': 3 })]), existingBySku: none, existingByBarcode: none, mode: 'skip' });
  await assert.rejects(() => applyPlan({ plan, ...fakeModels({ throwOther: true }), userId: 'u', newId }), /connection lost/);
});
