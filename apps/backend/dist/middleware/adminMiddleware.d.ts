import { Request, Response, NextFunction } from 'express';
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
export declare const adminMiddleware: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const requireActiveRole: (...allowedRoles: string[]) => (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const requireRole: (...allowedRoles: string[]) => (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
//# sourceMappingURL=adminMiddleware.d.ts.map