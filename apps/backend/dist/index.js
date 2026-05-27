"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const errorHandler_1 = require("./middleware/errorHandler");
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const customers_routes_1 = __importDefault(require("./modules/customers/customers.routes"));
const shipments_routes_1 = __importDefault(require("./modules/shipments/shipments.routes"));
const tracking_routes_1 = require("./modules/tracking/tracking.routes");
const invoices_routes_1 = __importDefault(require("./modules/invoices/invoices.routes"));
const payments_routes_1 = __importDefault(require("./modules/payments/payments.routes"));
const communications_routes_1 = __importDefault(require("./modules/communications/communications.routes"));
const newsletter_routes_1 = __importDefault(require("./modules/newsletter/newsletter.routes"));
const reports_routes_1 = __importDefault(require("./modules/reports/reports.routes"));
const search_routes_1 = __importDefault(require("./modules/search/search.routes"));
const admin_management_routes_1 = __importDefault(require("./modules/admin/admin_management.routes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://vhi-crm-admin.vercel.app',
    process.env.FRONTEND_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
].filter((origin) => Boolean(origin));
// Basic request logging to help diagnose CORS/preflight and auth issues
app.use((req, _res, next) => {
    const origin = req.headers.origin || 'no-origin';
    console.log(`[REQ] ${req.method} ${req.path} Origin=${origin}`);
    if (req.method === 'OPTIONS') {
        console.log('[PRELIGHT] headers:', req.headers);
    }
    next();
});
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // allow non-browser requests (like curl, server-to-server) which have no origin
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin))
            return callback(null, true);
        // allow any localhost with different port (development convenience)
        try {
            const url = new URL(origin);
            if (url.hostname === 'localhost')
                return callback(null, true);
        }
        catch (e) {
            // ignore
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/admin/search', search_routes_1.default);
app.use('/api/admin/admins', admin_management_routes_1.default);
app.use('/api/admin/customers', customers_routes_1.default);
app.use('/api/admin/shipments', shipments_routes_1.default);
app.use('/api/admin/tracking', tracking_routes_1.adminTrackingRoutes);
app.use('/api/tracking', tracking_routes_1.publicTrackingRoutes);
app.use('/api/admin/invoices', invoices_routes_1.default);
app.use('/api/payments', payments_routes_1.default);
app.use('/api/admin/payments', payments_routes_1.default);
app.use('/api/admin/communications', communications_routes_1.default);
app.use('/api/admin/newsletter', newsletter_routes_1.default);
app.use('/api/admin/reports', reports_routes_1.default);
// Health check
app.get('/api/health', (_req, res) => {
    res.json({ success: true, message: 'VHI CRM API is running' });
});
// Error handler
app.use(errorHandler_1.errorHandler);
app.listen(PORT, () => {
    console.log(`VHI CRM Server running on port ${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map