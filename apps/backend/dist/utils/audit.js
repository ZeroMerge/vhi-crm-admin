"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAuditEvent = logAuditEvent;
const db_1 = __importDefault(require("../config/db"));
async function logAuditEvent(adminId, activeRole, action, resourceType, resourceId, metadata) {
    try {
        const queryText = `
      INSERT INTO audit_logs (admin_id, active_role, action, resource_type, resource_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;
    `;
        const params = [
            adminId,
            activeRole,
            action,
            resourceType,
            resourceId || null,
            metadata ? JSON.stringify(metadata) : '{}'
        ];
        await db_1.default.query(queryText, params);
    }
    catch (err) {
        console.error('Failed to log audit event:', err);
    }
}
//# sourceMappingURL=audit.js.map