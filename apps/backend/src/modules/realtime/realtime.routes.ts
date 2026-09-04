import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { customerMiddleware } from '../../middleware/customerMiddleware';

const router = Router();

const issueRealtimeToken = (subject: string, email: string, appRole: 'admin' | 'customer') => {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  const issuer = process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
    : undefined;

  return jwt.sign(
    { sub: subject, role: 'authenticated', app_role: appRole, email },
    secret,
    { expiresIn: '1h', ...(issuer ? { issuer } : {}), audience: 'authenticated' }
  );
};

router.get('/admin-token', adminMiddleware, (req, res) => {
  const token = issueRealtimeToken(req.admin!.id, req.admin!.email, 'admin');
  if (!token) {
    return res.status(503).json({ success: false, message: 'Supabase Realtime is not configured' });
  }
  res.json({ success: true, data: { token } });
});

router.get('/client-token', customerMiddleware, (req, res) => {
  const token = issueRealtimeToken(req.customer!.id, req.customer!.email, 'customer');
  if (!token) {
    return res.status(503).json({ success: false, message: 'Supabase Realtime is not configured' });
  }
  res.json({ success: true, data: { token } });
});

export default router;
