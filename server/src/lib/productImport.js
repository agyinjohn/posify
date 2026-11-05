import { r6 } from './money.js';

/**
 * Bulk product import: spreadsheet rows -> validated product records. Pure (no DB) so it can be tested.
 * Column titles are matched loosely ("Cost per carton", "cost_per_ctn" and "CARTON COST" are all the same column),
 * and prices follow the same rules as the product form: single pieces sell at the piece price, a full pack at the
 * pack price; whichever is empty is worked out from the other.
 */

const ALIASES = {
  name: ['name', 'product', 'product name', 'item', 'item name', 'description'],
  size: ['size', 'variant', 'variation', 'size name', 'size label'],
  sku: ['sku', 'code', 'item code', 'product code'],
  barcode: ['barcode', 'bar code', 'upc', 'ean'],
  category: ['category', 'group', 'type'],
  unitsPerPack: ['pieces per pack', 'units per pack', 'pack size', 'pieces per carton', 'units per carton', 'pieces per ctn', 'pieces per box', 'units per box', 'ctn size', 'carton size', 'box size', 'qty per carton', 'qty per pack', 'qty per box'],
  packLabel: ['pack name', 'pack label', 'pack unit', 'pack type', 'unit name', 'carton name'],
  costPiece: ['cost', 'cost price', 'cost per piece', 'piece cost', 'unit cost', 'cost per unit', 'cost per pc', 'buying price', 'purchase price'],
  costPack: ['cost per pack', 'cost per carton', 'cost per box', 'cost per ctn', 'carton cost', 'pack cost', 'box cost', 'ctn cost', 'buying price per carton', 'buying price per pack'],
  retailPiece: ['price', 'selling price', 'retail', 'retail price', 'retail price per piece', 'retail per piece', 'piece price', 'unit price', 'price per piece', 'selling price per piece', 'sell price'],
  retailPack: ['retail price per pack', 'retail price per carton', 'retail price per box', 'retail price per ctn', 'retail per pack', 'retail per carton', 'carton price', 'pack price', 'box price', 'ctn price', 'price per carton', 'price per pack', 'price per box', 'selling price per carton', 'selling price per pack', 'selling price per box'],
  wholesalePiece: ['wholesale', 'wholesale price', 'wholesale price per piece', 'wholesale per piece', 'wholesale piece price'],
  wholesalePack: ['wholesale price per pack', 'wholesale price per carton', 'wholesale price per box', 'wholesale price per ctn', 'wholesale per pack', 'wholesale per carton', 'wholesale carton price', 'wholesale pack price'],
  stockPieces: ['opening stock', 'stock', 'quantity', 'qty', 'opening stock pieces', 'stock pieces', 'opening stock in pieces', 'opening qty'],
  stockPacks: ['opening stock packs', 'opening stock cartons', 'opening stock boxes', 'stock cartons', 'stock packs', 'stock boxes', 'cartons', 'packs', 'opening stock ctn', 'opening stock in cartons', 'opening stock in packs'],
  reorderLevel: ['reorder level', 'reorder', 'min stock', 'minimum stock', 'low stock level', 'reorder point'],
};

// "Cost (GH₵) / Piece" -> "cost gh piece": lower case, letters and digits only, single spaces.
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const LOOKUP = new Map();
for (const [field, names] of Object.entries(ALIASES)) for (const n of names) LOOKUP.set(norm(n), field);
// Currency words people put in column titles ("Cost (GHS)", "Price GH₵") should not stop a match.
const stripCurrency = (s) => norm(s).replace(/\b(ghs|gh|ghc|cedis?|cedi|usd|ngn)\b/g, ' ').replace(/\s+/g, ' ').trim();

export function mapHeaders(headers) {
  const map = new Map(); // column index -> field
  const recognized = [];
  const ignored = [];
  const taken = new Set();
  headers.forEach((h, i) => {
    const key = norm(h);
    const field = LOOKUP.get(key) ?? LOOKUP.get(stripCurrency(h)) ?? null;
    if (field && !taken.has(field)) { map.set(i, field); taken.add(field); recognized.push({ header: String(h), field }); }
    else if (String(h).trim()) ignored.push(String(h));
  });
  return { map, recognized, ignored };
}

// "GH₵ 1,250.50" -> 1250.5, "" -> null, "abc" -> NaN
export function parseNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '-') return null;
  const cleaned = s.replace(/[^\d.,-]/g, '');
  if (cleaned === '') return NaN;
  // "1.250,50" (comma decimal) vs "1,250.50": the last separator is the decimal point when two kinds appear
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let t = cleaned;
  if (lastComma > -1 && lastDot > -1) t = lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  else if (lastComma > -1) t = /^-?\d{1,3}(,\d{3})+$/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** One spreadsheet row (array of cells) -> { data, errors, warnings }. */
export function normalizeRow(cells, map) {
  const raw = {};
  for (const [i, field] of map) raw[field] = cells[i];
  const errors = [];
  const warnings = [];
  const get = (field, label) => {
    const n = parseNumber(raw[field]);
    if (Number.isNaN(n)) { errors.push(`${label} "${String(raw[field]).trim()}" is not a number`); return null; }
    if (n !== null && n < 0) { errors.push(`${label} cannot be negative`); return null; }
    return n;
  };

  const name = text(raw.name, 120);
  if (!name) errors.push('Name is missing');

  let units = get('unitsPerPack', 'Pieces per pack');
  if (units !== null && (!Number.isInteger(units) || units < 1 || units > 100000)) { errors.push('Pieces per pack must be a whole number, 1 or more'); units = null; }
  const packed = units !== null && units > 1;

  const costPiece = get('costPiece', 'Cost per piece');
  const costPack = get('costPack', 'Cost per pack');
  const retailPiece = get('retailPiece', 'Retail price per piece');
  const retailPack = get('retailPack', 'Retail price per pack');
  const wsPiece = get('wholesalePiece', 'Wholesale price per piece');
  const wsPack = get('wholesalePack', 'Wholesale price per pack');
  const stockPieces = get('stockPieces', 'Opening stock');
  const stockPacks = get('stockPacks', 'Opening stock (packs)');
  const reorderLevel = get('reorderLevel', 'Reorder level');

  const anyPack = [costPack, retailPack, wsPack, stockPacks].some((v) => v !== null);
  if (!packed && anyPack && !errors.some((e) => e.startsWith('Pieces per pack'))) {
    if (stockPacks !== null) errors.push('Opening stock in packs needs "Pieces per pack" (more than 1)');
    else warnings.push('Pack prices ignored: "Pieces per pack" is empty or 1');
  }

  // One price per piece (single pieces, retail) and one per pack (a full pack, wholesale). "Wholesale" columns from
  // older sheets are read as the pack price. An empty piece price is worked out from the pack price, as in the form.
  let packPrice = packed ? (wsPack ?? retailPack) : null;
  if (packed && wsPack !== null && retailPack !== null && Math.abs(wsPack - retailPack) > 0.005) warnings.push(`Two pack prices given (${retailPack} and wholesale ${wsPack}): a full pack sells at the wholesale price ${wsPack}`);
  if (packed && packPrice === null && wsPiece !== null) { packPrice = wsPiece * units; warnings.push(`Wholesale price per piece × ${units} = ${r6(packPrice)} is used as the pack price`); }
  if (!packed && (wsPiece !== null || wsPack !== null) && !anyPack) warnings.push('Wholesale price ignored: a product with no pack size has one price');
  const cost = costPiece ?? (packed && costPack !== null ? costPack / units : null);
  const retail = retailPiece ?? (packed && packPrice !== null ? packPrice / units : null);
  if (retail === null || retail <= 0) { if (!errors.some((e) => e.startsWith('Retail'))) errors.push('Selling price is missing or zero (per piece, or per pack together with "Pieces per pack")'); }
  if (cost === null) warnings.push('No cost given: cost is saved as 0, so profit will look like the full price');
  if (cost !== null && retail > 0 && cost > retail) warnings.push('Cost is higher than the selling price');
  if (packed && packPrice !== null && retail > 0 && packPrice > retail * units + 0.005) warnings.push('A full pack costs more than the same number of single pieces');
  if (packed && costPiece !== null && costPack !== null && Math.abs(costPack / units - costPiece) > 0.005) {
    warnings.push(`Cost per pack ÷ ${units} is ${r6(costPack / units)}, not the piece cost ${costPiece}. The piece cost is used`);
  }

  let stock = stockPieces ?? 0;
  if (stockPacks !== null && packed) {
    // Both columns filled means "this many packs plus these loose pieces": add them, and say so on the row.
    stock = Math.round((stockPacks * units + (stockPieces ?? 0)) * 1000) / 1000;
    if (stockPieces !== null) warnings.push(`Opening stock: ${stockPacks} pack${stockPacks === 1 ? '' : 's'} × ${units} + ${stockPieces} loose pieces = ${stock} pieces`);
  }
  if (stock > 1e6) { errors.push('Opening stock is too large'); stock = 0; }

  const data = {
    name,
    size: text(raw.size, 30),
    sku: text(raw.sku, 60),
    barcode: text(raw.barcode, 60) || undefined, // blank = no barcode (never stored as '')
    category: text(raw.category, 60) || 'General',
    unitsPerPack: packed ? units : 1,
    packLabel: packed ? text(raw.packLabel, 20) : '',
    costPrice: r6(cost ?? 0),
    retailPrice: r6(retail ?? 0),
    wholesalePrice: 0,      // retired: a full pack's price is the wholesale price
    packRetailPrice: packed && packPrice !== null ? r6(packPrice) : 0,
    packWholesalePrice: 0,
    reorderLevel: reorderLevel ?? 0,
    stock,
  };
  return { data, errors, warnings };
}

const slug = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

/**
 * Decide what to do with every row. existingBySku / existingByBarcode: Map of what is already in the shop
 * ({ _id, sku, barcode }). mode 'skip' leaves existing SKUs alone, 'update' changes their details and prices
 * (never their stock).
 */
export function planImport({ rows, existingBySku, existingByBarcode, mode }) {
  const skus = new Map();     // sku -> first row number in this file
  const barcodes = new Map(); // barcode -> sku of the row that claimed it
  const usedSkus = (s) => skus.has(s) || existingBySku.has(s);

  return rows.map(({ row, data, errors, warnings }) => {
    const entry = { row, name: data.size ? `${data.name} (${data.size})` : data.name, sku: data.sku, status: 'create', errors: [...errors], warnings: [...warnings], data, existingId: null, generatedSku: false };
    if (entry.errors.length) { entry.status = 'error'; return entry; }

    if (!data.sku) {
      // No SKU in the sheet: use the barcode, else a short code made from the name, kept unique.
      let base = data.barcode || slug(data.size ? `${data.name} ${data.size}` : data.name) || 'ITEM';
      let candidate = base; let n = 1;
      while (usedSkus(candidate)) { n += 1; candidate = `${base}-${n}`; }
      data.sku = candidate; entry.sku = candidate; entry.generatedSku = true;
      entry.warnings.push(`No SKU given: using ${candidate}`);
    }

    if (skus.has(data.sku)) { entry.status = 'error'; entry.errors.push(`Same SKU as row ${skus.get(data.sku)} in this file`); return entry; }
    skus.set(data.sku, row);

    const existing = existingBySku.get(data.sku);
    if (data.barcode) {
      const owner = barcodes.get(data.barcode) ?? existingByBarcode.get(data.barcode)?.sku;
      if (owner && owner !== data.sku) { entry.status = 'error'; entry.errors.push(`Barcode ${data.barcode} is already used by ${owner}`); return entry; }
      barcodes.set(data.barcode, data.sku);
    }

    if (existing) {
      entry.existingId = existing._id;
      if (mode === 'update') {
        entry.status = 'update';
        if (data.stock > 0) entry.warnings.push('Existing product: opening stock ignored (use Stock to change stock)');
      } else {
        entry.status = 'skip';
        entry.warnings.push('SKU already exists: skipped');
      }
    }
    return entry;
  });
}

export const summarize = (plan) => ({
  total: plan.length,
  create: plan.filter((e) => e.status === 'create').length,
  update: plan.filter((e) => e.status === 'update').length,
  skip: plan.filter((e) => e.status === 'skip').length,
  error: plan.filter((e) => e.status === 'error').length,
  warnings: plan.filter((e) => e.warnings.length && e.status !== 'error').length,
});

// The fields an update may change. Stock and the SKU are never touched; blank optional cells do not erase data.
export function updateFields(data) {
  const set = {
    name: data.name, size: data.size, category: data.category, costPrice: data.costPrice, retailPrice: data.retailPrice,
    wholesalePrice: data.wholesalePrice, packRetailPrice: data.packRetailPrice, packWholesalePrice: data.packWholesalePrice,
    unitsPerPack: data.unitsPerPack, packLabel: data.packLabel, reorderLevel: data.reorderLevel,
  };
  if (data.barcode) set.barcode = data.barcode;
  return set;
}

/**
 * Write the plan. Models are passed in so this can be tested without a database.
 * Failed rows are reported, the rest still go in (the database cannot do all-or-nothing here).
 */
export async function applyPlan({ plan, Product, StockMovement, userId, newId }) {
  const results = new Map(); // row -> { ok, message? }
  const creates = plan.filter((e) => e.status === 'create');
  const updates = plan.filter((e) => e.status === 'update');

  if (creates.length) {
    const docs = creates.map((e) => ({ _id: newId(), ...e.data }));
    const failed = new Map(); // index -> message
    try {
      await Product.bulkWrite(docs.map((document) => ({ insertOne: { document } })), { ordered: false });
    } catch (err) {
      const list = [].concat(err?.writeErrors ?? err?.result?.writeErrors ?? []);
      if (!list.length) throw err; // not a per-row problem: let the caller report it
      for (const we of list) {
        const index = we.index ?? we.err?.index;
        const code = we.code ?? we.err?.code;
        const msg = we.errmsg ?? we.err?.errmsg ?? '';
        const rule = /index: (\S+)/.exec(msg)?.[1];
        failed.set(index, code === 11000 ? `SKU or barcode is already in use${rule ? ` (database rule ${rule})` : ''}` : (msg || 'The database rejected this row'));
      }
    }
    const moves = [];
    creates.forEach((e, i) => {
      if (failed.has(i)) { results.set(e.row, { ok: false, message: failed.get(i) }); return; }
      results.set(e.row, { ok: true });
      if (e.data.stock > 0) moves.push({ product: docs[i]._id, type: 'opening', qty: e.data.stock, costPrice: e.data.costPrice, reason: 'Bulk import', user: userId });
    });
    if (moves.length) await StockMovement.insertMany(moves);
  }

  if (updates.length) {
    const ops = updates.map((e) => ({ updateOne: { filter: { _id: e.existingId }, update: { $set: updateFields(e.data) } } }));
    const failed = new Map();
    try {
      await Product.bulkWrite(ops, { ordered: false });
    } catch (err) {
      const list = [].concat(err?.writeErrors ?? err?.result?.writeErrors ?? []);
      if (!list.length) throw err;
      for (const we of list) failed.set(we.index ?? we.err?.index, we.code === 11000 || we.err?.code === 11000 ? 'Barcode is already in use' : (we.errmsg ?? we.err?.errmsg ?? 'The database rejected this row'));
    }
    updates.forEach((e, i) => results.set(e.row, failed.has(i) ? { ok: false, message: failed.get(i) } : { ok: true }));
  }
  return results;
}
