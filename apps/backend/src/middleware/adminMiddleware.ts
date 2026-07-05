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

    
    
    if (
      req.admin.activeRole === 'support_staff' &&
      ['POST', 'PUT', 'DELETE'].includes(req.method)
    ) {
      const isAuthAction = req.path.endsWith('/switch-role') || req.path.endsWith('/logout') || req.path.endsWith('/admin/logout');
      const isCustomerAction = req.path.includes('/admin/customers') && req.method !== 'DELETE';
      
      if (!isAuthAction && !isCustomerAction) {
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
