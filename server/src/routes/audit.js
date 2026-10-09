import { Router } from 'express';
import AuditLog from '../models/AuditLog.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { dayRange } from '../lib/validate.js';

const router = Router();
router.use(requireAuth, requireOwner);

router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.from || req.query.to) {
    const { start, end } = dayRange(req.query.from, req.query.to);
    filter.createdAt = { $gte: start, $lt: end };
  }
  if (typeof req.query.action === 'string' && req.query.action) {
    filter.action = new RegExp(`^${req.query.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  }
  const rows = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .populate('user', 'name username');
  res.json(rows);
}));

export default router;
