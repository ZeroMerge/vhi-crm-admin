import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AdminPayload {
  id: string;
  email: string;
  activeRole: string;
  assignedRoles: string[];
  role?: string; 
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPayload;
    }
  }
}

// support_staff is read-only except these exact writes (method + full path incl. mount point).
// Customer scope is create + profile edit only; star/status/segment/delete stay blocked (client to confirm, OPEN-QUESTIONS).
const SUPPORT_STAFF_WRITES: Array<[string, RegExp]> = [
  ['POST', /^\/api\/auth\/admin\/(switch-role|logout)$/],
  ['PUT', /^\/api\/auth\/admin\/(change-password|profile|notification-preferences)$/],
  ['POST', /^\/api\/admin\/customers$/],
  ['PUT', /^\/api\/admin\/customers\/[^/]+$/],
  // Phase 5: marking a thread read (support staff's thread view marked read via GET before; read state only).
  ['POST', /^\/api\/admin\/communications\/[^/]+\/read$/],
];

export function supportStaffMayWrite(method: string, fullPath: string): boolean {
  const normalized = fullPath.replace(/\/+$/, '') || '/';
  return SUPPORT_STAFF_WRITES.some(([m, re]) => m === method && re.test(normalized));
}

export const adminMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || 'fallback_secret') as AdminPayload;
    
    
    if (!decoded.activeRole && decoded.role) {
      decoded.activeRole = decoded.role;
    }
    if (!decoded.assignedRoles) {
      decoded.assignedRoles = [decoded.activeRole];
    }
    
    req.admin = decoded;

    
    
    // req.path is relative to the router mount point, so match on baseUrl + path (RISKS R-20).
    if (
      req.admin.activeRole === 'support_staff' &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      !supportStaffMayWrite(req.method, `${req.baseUrl}${req.path}`)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Operation denied: Support staff role is read-only.'
      });
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

export const requireActiveRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const activeRole = req.admin.activeRole;
    
    
    if (allowedRoles.includes('*') && activeRole === 'super_admin') {
      return next();
    }
    
    if (activeRole === 'super_admin') {
      return next(); 
    }

    if (!allowedRoles.includes(activeRole)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    
    next();
  };
};


export const requireRole = requireActiveRole;
