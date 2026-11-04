import AuditLog from '../models/AuditLog.js';
import { currentShop } from './tenant.js';

/**
 * Write an audit entry. Never throws — a logging failure must not break the request.
 * @param {object} opts
 * @param {import('express').Request} [opts.req]  - express request (for user + IP)
 * @param {string}  opts.action   - dot-namespaced verb, e.g. 'product.edit'
 * @param {string}  [opts.target] - human-readable label of the affected record
 * @param {*}       [opts.targetId]
 * @param {object}  [opts.detail] - arbitrary diff / extra context
 * @param {string}  [opts.username] - for login events before req.user is set
 * @param {*}       [opts.shop] - the shop, when there is no signed-in request (sign-in, platform admin)
 */
export function audit({ req, action, target, targetId, detail, username, shop } = {}) {
  // Each shop has its own audit log. With no shop known (e.g. a sign-in attempt for a username that does not
  // exist) there is no shop log to write to.
  const forShop = shop ?? currentShop();
  if (!forShop) return;
  const entry = {
    shop: forShop,
    action,
    target: target ?? null,
    targetId: targetId ?? null,
    detail: detail ?? null,
    user: req?.user?._id ?? null,
    username: username ?? req?.user?.username ?? null,
    ip: req?.ip ?? null,
  };
  AuditLog.create(entry).catch((err) => console.error('audit write failed', err.message));
}
