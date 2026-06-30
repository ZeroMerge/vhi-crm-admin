"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.requireActiveRole = exports.adminMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const adminMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.ADMIN_JWT_SECRET || 'fallback_secret');
        if (!decoded.activeRole && decoded.role) {
            decoded.activeRole = decoded.role;
        }
        if (!decoded.assignedRoles) {
            decoded.assignedRoles = [decoded.activeRole];
        }
        req.admin = decoded;
        if (req.admin.activeRole === 'support_staff' &&
            ['POST', 'PUT', 'DELETE'].includes(req.method)) {
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
    }
    catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};
exports.adminMiddleware = adminMiddleware;
const requireActiveRole = (...allowedRoles) => {
    return (req, res, next) => {
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
exports.requireActiveRole = requireActiveRole;
exports.requireRole = exports.requireActiveRole;
//# sourceMappingURL=adminMiddleware.js.map