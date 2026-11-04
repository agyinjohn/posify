import { currentShop, runAsShop } from './tenant.js';

// Runs an async route handler and passes errors to Express. For a signed-in shop user it also makes sure the
// handler runs inside that user's shop (see lib/tenant.js): some middleware, such as multer's upload parsing,
// calls next() from an event callback that has lost the request's context.
export const asyncHandler = (fn) => (req, res, next) => {
  const run = () => Promise.resolve(fn(req, res, next)).catch(next);
  return req.user?.shop && !currentShop() ? runAsShop(req.user.shop, run) : run();
};
