import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { tenantPlugin, runAsShop, currentShop, scopeFilter, stampDocs, scopeBulkOps, TenantContextError } from '../src/lib/tenant.js';
import { seal, open, tempPassword } from '../src/lib/secretBox.js';

// A throwaway model with the plugin, plus a last hook that records what would be sent to the database and stops
// before it (no database needed).
mongoose.set('bufferCommands', false);
const schema = new mongoose.Schema({ name: String });
schema.plugin(tenantPlugin);
let seen = null;
const STOP = 'STOP';
for (const op of ['find', 'findOne', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteMany', 'deleteOne', 'countDocuments', 'findOneAndDelete', 'distinct']) {
  schema.pre(op, { document: false, query: true }, function () { seen = this.getFilter(); throw new Error(STOP); });
}
schema.pre('aggregate', function () { seen = this.pipeline(); throw new Error(STOP); });
schema.pre('save', function () { seen = String(this.shop); throw new Error(STOP); });
schema.pre('bulkWrite', function (next, ops) { seen = ops; next(new Error(STOP)); });
schema.pre('insertMany', function (next, docs) { seen = docs; next(new Error(STOP)); });
const T = mongoose.model('TenantTest', schema);

const A = new mongoose.Types.ObjectId();
const B = new mongoose.Types.ObjectId();
const run = async (fn) => { seen = null; try { await fn(); } catch (e) { if (e.message !== STOP) throw e; } return seen; };

test('pure helpers add the shop and refuse another shop\'s records', () => {
  assert.equal(String(scopeFilter({ a: 1 }, A).shop), String(A));
  assert.equal(String(stampDocs([{ a: 1 }], A)[0].shop), String(A));
  assert.throws(() => stampDocs([{ a: 1, shop: B }], A), TenantContextError);
  const ops = scopeBulkOps([{ insertOne: { document: {} } }, { updateOne: { filter: { x: 1 }, update: {} } }, { deleteMany: { filter: {} } }], A);
  assert.equal(String(ops[0].insertOne.document.shop), String(A));
  assert.equal(String(ops[1].updateOne.filter.shop), String(A));
  assert.equal(String(ops[2].deleteMany.filter.shop), String(A));
});

test('outside a shop, reads and writes on shop data are refused (fail closed)', async () => {
  await assert.rejects(() => T.find({}), TenantContextError);
  await assert.rejects(() => T.updateOne({}, { $set: { name: 'x' } }), TenantContextError);
  await assert.rejects(() => T.aggregate([]), TenantContextError);
  await assert.rejects(() => T.bulkWrite([{ insertOne: { document: {} } }]), TenantContextError);
  await assert.rejects(() => T.create({ name: 'x' }), TenantContextError);
  await assert.rejects(() => T.estimatedDocumentCount(), TenantContextError);
  assert.equal(currentShop(), null);
});

test('inside a shop, every operation is limited to that shop', async () => {
  await runAsShop(A, async () => {
    for (const [label, fn] of [
      ['find', () => T.find({ name: 'a' })], ['findById', () => T.findById(new mongoose.Types.ObjectId())], ['exists', () => T.exists({ name: 'b' })],
      ['updateOne', () => T.updateOne({ name: 'a' }, { $set: { name: 'b' } })], ['updateMany', () => T.updateMany({}, { $set: { name: 'b' } })],
      ['findOneAndUpdate', () => T.findOneAndUpdate({}, { $inc: { n: 1 } })], ['deleteMany', () => T.deleteMany({})], ['deleteOne', () => T.deleteOne({})],
      ['countDocuments', () => T.countDocuments({})], ['findOneAndDelete', () => T.findOneAndDelete({})], ['distinct', () => T.distinct('name')],
    ]) {
      const filter = await run(fn);
      assert.equal(String(filter.shop), String(A), `${label} must filter by the shop`);
    }
    const pipeline = await run(() => T.aggregate([{ $group: { _id: null } }]));
    assert.equal(String(pipeline[0].$match.shop), String(A));
    assert.equal(await run(() => T.create({ name: 'a' })), String(A));
    const ops = await run(() => T.bulkWrite([{ insertOne: { document: { name: 'q' } } }, { updateOne: { filter: { name: 'q' }, update: { $set: { name: 'r' } } } }]));
    assert.deepEqual(ops.map((o) => String(Object.values(o)[0].document?.shop ?? Object.values(o)[0].filter?.shop)), [String(A), String(A)]);
    const docs = await run(() => T.insertMany([{ name: 'a' }, { name: 'b' }]));
    assert.deepEqual(docs.map((d) => String(d.shop)), [String(A), String(A)]);
    // a record that names another shop cannot be written from here
    await assert.rejects(() => T.create({ name: 'x', shop: B }), TenantContextError);
  });
});

test('shops do not leak into each other, even when requests overlap', async () => {
  const filters = await Promise.all([A, B, A, B].map((shop) => runAsShop(shop, async () => {
    await new Promise((r) => setTimeout(r, Math.random() * 20));
    return run(() => T.find({}));
  })));
  assert.deepEqual(filters.map((f) => String(f.shop)), [A, B, A, B].map(String));
});

test('code that works across shops must ask for it explicitly', async () => {
  const filter = await run(() => T.find({ name: 'a' }).setOptions({ skipTenant: true }));
  assert.equal(filter.shop, undefined);
  assert.equal(await run(() => T.create({ name: 'a', shop: B })), String(B)); // system code stamps the shop itself
});

test('owner temporary passwords: sealed, readable only with the server secret', () => {
  const p = tempPassword();
  assert.match(p, /^[a-hj-km-np-zA-HJ-KM-NP-Z2-9]{12}$/);
  const box = seal(p, 'secret-1');
  assert.ok(!box.includes(p));
  assert.equal(open(box, 'secret-1'), p);
  assert.equal(open(box, 'secret-2'), null);
  assert.equal(open('garbage', 'secret-1'), null);
});
