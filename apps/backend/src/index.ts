import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { errorHandler } from './middleware/errorHandler';
import authRoutes from './modules/auth/auth.routes';
import customersRoutes from './modules/customers/customers.routes';
import shipmentsRoutes from './modules/shipments/shipments.routes';
import { adminTrackingRoutes, publicTrackingRoutes } from './modules/tracking/tracking.routes';
import invoicesRoutes from './modules/invoices/invoices.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import communicationsRoutes from './modules/communications/communications.routes';
import newsletterRoutes from './modules/newsletter/newsletter.routes';
import reportsRoutes from './modules/reports/reports.routes';
import searchRoutes from './modules/search/search.routes';
import adminManagementRoutes from './modules/admin/admin_management.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL || 'http://localhost:5173'
];

// Basic request logging to help diagnose CORS/preflight and auth issues
app.use((req, _res, next) => {
  const origin = req.headers.origin || 'no-origin';
  console.log(`[REQ] ${req.method} ${req.path} Origin=${origin}`);
  if (req.method === 'OPTIONS') {
    console.log('[PRELIGHT] headers:', req.headers);
  }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // allow non-browser requests (like curl, server-to-server) which have no origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // allow any localhost with different port (development convenience)
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost') return callback(null, true);
    } catch (e) {
      // ignore
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin/search', searchRoutes);
app.use('/api/admin/admins', adminManagementRoutes);
app.use('/api/admin/customers', customersRoutes);
app.use('/api/admin/shipments', shipmentsRoutes);
app.use('/api/admin/tracking', adminTrackingRoutes);
app.use('/api/tracking', publicTrackingRoutes);
app.use('/api/admin/invoices', invoicesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin/payments', paymentsRoutes);
app.use('/api/admin/communications', communicationsRoutes);
app.use('/api/admin/newsletter', newsletterRoutes);
app.use('/api/admin/reports', reportsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'VHI CRM API is running' });
});

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`VHI CRM Server running on port ${PORT}`);
});

export default app;
