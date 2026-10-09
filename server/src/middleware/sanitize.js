// Rejects Mongo operator injection ({"$ne": ...}) and dotted keys in body and query.
const bad = (v, depth = 0) => {
  if (depth > 8 || v === null || typeof v !== 'object') return false;
  return Object.keys(v).some((k) => k.startsWith('$') || k.includes('.') || bad(v[k], depth + 1));
};

export const sanitize = (req, res, next) =>
  bad(req.body) || bad(req.query) ? res.status(400).json({ error: 'Invalid request' }) : next();
