import { Router, Request, Response, NextFunction } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { customerMiddleware } from '../../middleware/customerMiddleware';
import { modulesForRoles, requireActiveAdmin } from '../../middleware/permissions';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_BIGINT = 9223372036854775807n;
const ID_RE = /^[1-9]\d{0,18}$/;

interface Scope {
  column: 'admin_id' | 'customer_id';
  recipientId: string;
  // Admin rows only: modules readable by any of the admin's CURRENT assigned roles (null = all).
  modules: string[] | null;
}

const isBigintId = (value: unknown): value is string =>
  typeof value === 'string' && ID_RE.test(value) && BigInt(value) <= MAX_BIGINT;

function mapNotification(row: any) {
  return {
    id: String(row.id),
    type: row.type,
    module: row.module,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// Owner + module visibility condition shared by every query. $1 = recipient id, $2 = modules (null = all).
const VISIBLE = (column: Scope['column']) => `${column} = $1 AND ($2::text[] IS NULL OR module = ANY($2::text[]))`;

function notificationsRouter(resolveScope: (req: Request) => Promise<Scope | null>) {
  const router = Router();

  const withScope =
    (handler: (req: Request, res: Response, scope: Scope) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const scope = await resolveScope(req);
        if (!scope) return res.status(401).json({ success: false, message: 'Unauthorized' });
        await handler(req, res, scope);
      } catch (err) { next(err); }
    };

  // GET /?before=<id>&limit=<n>  newest first; nextCursor is the id to pass as `before` for the next page.
  router.get('/', withScope(async (req, res, scope) => {
    const { before, limit } = req.query;
    if (before !== undefined && !isBigintId(before)) {
      return res.status(400).json({ success: false, message: 'before must be a notification id' });
    }
    if (limit !== undefined && !(typeof limit === 'string' && /^\d+$/.test(limit) && Number(limit) >= 1)) {
      return res.status(400).json({ success: false, message: 'limit must be a positive integer' });
    }
    const pageSize = Math.min(limit === undefined ? DEFAULT_LIMIT : Number(limit), MAX_LIMIT);

    const { rows } = await pool.query(
      `SELECT * FROM notifications
        WHERE ${VISIBLE(scope.column)} AND ($3::bigint IS NULL OR id < $3::bigint)
        ORDER BY id DESC
        LIMIT $4`,
      [scope.recipientId, scope.modules, before ?? null, pageSize + 1]
    );
    const page = rows.slice(0, pageSize);
    res.json({
      success: true,
      data: page.map(mapNotification),
      nextCursor: rows.length > pageSize ? String(page[page.length - 1].id) : null,
    });
  }));

  router.get('/unread-count', withScope(async (_req, res, scope) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE ${VISIBLE(scope.column)} AND read_at IS NULL`,
      [scope.recipientId, scope.modules]
    );
    res.json({ success: true, data: { count: rows[0].count } });
  }));

  // Someone else's (or a hidden) notification is indistinguishable from a missing one: 404.
  router.post('/:id/read', withScope(async (req, res, scope) => {
    if (!isBigintId(req.params.id)) return res.status(404).json({ success: false, message: 'Notification not found' });
    const { rows } = await pool.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
        WHERE id = $3::bigint AND ${VISIBLE(scope.column)}
        RETURNING *`,
      [scope.recipientId, scope.modules, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, data: mapNotification(rows[0]) });
  }));

  router.post('/read-all', withScope(async (_req, res, scope) => {
    const result = await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE ${VISIBLE(scope.column)} AND read_at IS NULL`,
      [scope.recipientId, scope.modules]
    );
    res.json({ success: true, data: { updated: result.rowCount ?? 0 } });
  }));

  return router;
}

// /api/admin/notifications: account check, no module guard; rows filtered by the admin's current assigned roles.
const adminRouter = Router();
adminRouter.use(adminMiddleware, requireActiveAdmin);
adminRouter.use(
  notificationsRouter(async (req) => {
    const { rows } = await pool.query('SELECT assigned_roles FROM admins WHERE id = $1', [req.admin!.id]);
    if (rows.length === 0) return null;
    return { column: 'admin_id', recipientId: req.admin!.id, modules: modulesForRoles(rows[0].assigned_roles || []) };
  })
);

// /api/client/notifications: the customer's own rows.
const clientRouter = Router();
clientRouter.use(customerMiddleware);
clientRouter.use(notificationsRouter(async (req) => ({ column: 'customer_id', recipientId: req.customer!.id, modules: null })));

export { adminRouter as adminNotificationsRoutes, clientRouter as clientNotificationsRoutes };
