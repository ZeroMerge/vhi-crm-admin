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
import feedbackRoutes from './modules/feedback/feedback.routes';
import searchRoutes from './modules/search/search.routes';
import adminManagementRoutes from './modules/admin/admin_management.routes';
import clientAuthRoutes from './modules/client/client.auth.routes';
import clientShipmentsRoutes from './modules/client/client.shipments.routes';
import clientTrackingRoutes from './modules/client/client.tracking.routes';
import clientCargoRoutes from './modules/client/client.cargo.routes';
import { customerMiddleware } from './middleware/customerMiddleware';
import clientCommunicationsRoutes from './modules/client/client.communications.routes';
import realtimeRoutes from './modules/realtime/realtime.routes';
import { adminNotificationsRoutes, clientNotificationsRoutes } from './modules/notifications/notifications.routes';
import { getRealtime, startRealtime, stopRealtime } from './modules/notifications/realtime';
import emailRoutes from './modules/email/email.routes';
import clientPreferencesRoutes from './modules/client/client.preferences.routes';
import { initEmail, startEmailWorker, stopEmailWorker } from './modules/email';
import { initScheduler, startScheduler, stopScheduler } from './modules/scheduler';

dotenv.config();

// Email configuration is checked here, at startup, never at import time (RISKS R-01). In production a missing
// RESEND_API_KEY (with the resend provider), EMAIL_LINK_SECRET, API_PUBLIC_URL, CLIENT_FRONTEND_URL or
// ADMIN_FRONTEND_URL stops the server with a clear message instead of sending broken or no email.
try {
  const emailConfig = initEmail();
  for (const warning of emailConfig.warnings) console.warn(`[email] WARNING: ${warning}`);
} catch (err) {
  console.error(`[email] ${(err as Error).message}`);
  process.exit(1);
}
// Scheduler settings (SCHEDULER_ENABLED, APP_TIMEZONE, STUCK_*, OVERDUE_*, RETENTION_*): invalid values stop the server here too.
try {
  initScheduler();
} catch (err) {
  console.error(`[scheduler] ${(err as Error).message}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://vhi-crm-admin.vercel.app',
  'https://vhi-crm.netlify.app',
  process.env.ADMIN_FRONTEND_URL,
  process.env.CLIENT_FRONTEND_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
].filter((origin): origin is string => Boolean(origin));


app.use((req, _res, next) => {
  const origin = req.headers.origin || 'no-origin';
  console.log(`[REQ] ${req.method} ${req.path} Origin=${origin}`);
  if (req.method === 'OPTIONS') {
    console.log('[PRELIGHT] headers:', req.headers);
  }
  next();
});

// Email links (unsubscribe pages and their form/one-click POSTs) are plain HTML pages authorised by a signed token, with no
// cookies or credentials, so they are mounted BEFORE the CORS check: browsers post the confirmation form with
// `Origin: null` (the page sends Referrer-Policy: no-referrer), and mail providers post with no Origin at all.
app.use('/api/email', emailRoutes);

app.use(cors({
  origin: (origin, callback) => {
    
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost') return callback(null, true);
    } catch (e) {
      
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


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
app.use('/api/admin/feedback', feedbackRoutes);
app.use('/api/client/auth', clientAuthRoutes);
app.use('/api/client/shipments', clientShipmentsRoutes);
app.use('/api/client/tracking', clientTrackingRoutes);
app.use('/api/client/cargo-clearings', customerMiddleware, clientCargoRoutes);
app.use('/api/client/communications', clientCommunicationsRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/admin/notifications', adminNotificationsRoutes);
app.use('/api/client/notifications', clientNotificationsRoutes);
app.use('/api/client/notification-preferences', clientPreferencesRoutes);


app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'VHI CRM API is running' });
});


app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`VHI CRM Server running on port ${PORT}`);
  // Realtime push (SSE). If LISTEN cannot connect it keeps retrying; REST is unaffected and clients poll.
  startRealtime().catch((err) => console.error('[realtime] failed to start', err));
  // Email outbox worker: woken by NOTIFY on the realtime bus's LISTEN connection, plus a 30s poll.
  startEmailWorker((channel, handler) => getRealtime().bus.listenTo(channel, () => handler()));
  // Scheduled jobs (stuck shipments, overdue invoices, registration digest, cleanup). Safe with several instances (advisory locks).
  startScheduler();
});

// Graceful shutdown: end every SSE stream (clients reconnect to the next instance), stop LISTEN, stop accepting requests.
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${signal}] shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  // The scheduler stops first (waits for a running job, whose emails then still get sent), then the email worker, then realtime.
  stopScheduler()
    .catch((err) => console.error('[scheduler] failed to stop cleanly', err))
    .then(() => stopEmailWorker())
    .catch((err) => console.error('[email] worker failed to stop cleanly', err))
    .then(() => stopRealtime())
    .catch((err) => console.error('[realtime] failed to stop cleanly', err))
    .finally(() => server.close(() => process.exit(0)));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
