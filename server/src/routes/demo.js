import { Router } from 'express';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { SaleError } from '../lib/pricing.js';
import { audit } from '../lib/audit.js';
import { demoStatus, seedShop } from '../lib/seedDemoShop.js';

// Owner button "Load demo data": fills an empty shop with demo products and six weeks of sales. Replacing data that
// is already there is allowed only in the demo shop (SEED_DEMO_SHOP), and only after typing the shop's name.
const router = Router();
router.use(requireAuth, requireOwner);

let busy = false; // one seed at a time on this server

router.get('/', asyncHandler(async (req, res) => res.json(await demoStatus(req.shop))));

router.post('/seed', asyncHandler(async (req, res) => {
  const status = await demoStatus(req.shop);
  const replace = req.body?.replace === true;
  if (!status.empty) {
    if (!replace) throw new SaleError('This shop already has products or sales. Demo data can only be added to an empty shop', 409);
    if (!status.canReplace) throw new SaleError('Only the demo shop can have its data replaced', 403);
    const typed = typeof req.body?.confirm === 'string' ? req.body.confirm.trim().toLowerCase() : '';
    if (typed !== req.shop.name.trim().toLowerCase()) throw new SaleError('Type the shop name exactly to confirm');
  }
  if (busy) throw new SaleError('Demo data is already being loaded. Wait a moment', 409);
  busy = true;
  try {
    const summary = await seedShop(req.shop, { reset: !status.empty });
    audit({ req, action: status.empty ? 'demo.load' : 'demo.replace', target: req.shop.name, detail: summary });
    res.status(201).json(summary);
  } finally {
    busy = false;
  }
}));

export default router;
