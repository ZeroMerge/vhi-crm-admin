import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface CustomerPayload {
  id: string;
  email: string;
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerPayload;
    }
  }
}

export const customerMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(
      token,
      process.env.CLIENT_JWT_SECRET || 'client_fallback_secret'
    ) as CustomerPayload;
    req.customer = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};
