import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AdminPayload {
  id: string;
  email: string;
  activeRole: string;
  assignedRoles: string[];
  role?: string; // backward compatibility fallback
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPayload;
    }
  }
}

export const adminMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || 'fallback_secret') as AdminPayload;
    
    // Ensure we support activeRole and fallback role
    if (!decoded.activeRole && decoded.role) {
      decoded.activeRole = decoded.role;
    }
    if (!decoded.assignedRoles) {
      decoded.assignedRoles = [decoded.activeRole];
    }
    
    req.admin = decoded;

    // Support staff is strictly read-only on all backend mutating routes (POST, PUT, DELETE).
    // Exceptions: /switch-role and /logout are administrative auth actions and allowed.
    if (
      req.admin.activeRole === 'support_staff' &&
      ['POST', 'PUT', 'DELETE'].includes(req.method)
    ) {
      const isAuthAction = req.path.endsWith('/switch-role') || req.path.endsWith('/logout') || req.path.endsWith('/admin/logout');
      if (!isAuthAction) {
        return res.status(403).json({
          success: false,
          message: 'Operation denied: Support staff role is read-only.'
        });
      }
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
    
    // If the allowedRoles includes '*', full access is allowed
    if (allowedRoles.includes('*') && activeRole === 'super_admin') {
      return next();
    }
    
    if (activeRole === 'super_admin') {
      return next(); // super admin has access to everything
    }

    if (!allowedRoles.includes(activeRole)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    
    next();
  };
};

// Keep old requireRole exported as fallback alias pointing to requireActiveRole
export const requireRole = requireActiveRole;
