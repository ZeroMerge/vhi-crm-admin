"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAuditEvent = logAuditEvent;
const db_1 = __importDefault(require("../config/db"));
async function logAuditEvent(actorId, actorType, activeRole, action, resourceType, resourceId, metadata) {
    try {
        await db_1.default.query(`INSERT INTO audit_logs
         (admin_id, customer_id, actor_type, active_role, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
            actorType === 'admin' ? actorId : null,
            actorType === 'customer' ? actorId : null,
            actorType,
            activeRole,
            action,
            resourceType,
            resourceId || null,
            metadata ? JSON.stringify(metadata) : '{}',
        ]);
    }
    catch (err) {
        console.error('Failed to log audit event:', err);
    }
}
//# sourceMappingURL=audit.js.map