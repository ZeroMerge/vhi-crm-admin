// Preloaded before every test file (see the "test" script in package.json).
// It runs before any app module is imported, so config/db.ts and dotenv see the test environment only.
import fs from 'fs';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

// dotenv loads <cwd>/.env on import. Run from test/ (which has no .env) so the real
// apps/backend/.env is never loaded into the test process.
process.chdir(__dirname);
if (fs.existsSync('.env')) {
  throw new Error('test/.env must not exist: tests must never load real environment files.');
}

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  let url: URL;
  try {
    url = new URL(testUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection URL.');
  }
  const host = (url.searchParams.get('host') || url.hostname).replace(/^\[|\]$/g, '').toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`TEST_DATABASE_URL must point at localhost, 127.0.0.1 or ::1 (got host "${host}").`);
  }
  if (!/test/i.test(database)) {
    throw new Error(`TEST_DATABASE_URL database name must contain "test" (got "${database}"); the suite drops and recreates its schema.`);
  }
  process.env.DATABASE_URL = testUrl;
} else {
  // Unreachable on purpose: without a test DB, nothing may fall back to the app's default local database.
  process.env.DATABASE_URL = 'postgresql://no_test_db@127.0.0.1:1/no_test_db';
}

process.env.NODE_ENV = 'test';
process.env.ADMIN_JWT_SECRET = 'test-admin-secret';
process.env.CLIENT_JWT_SECRET = 'test-client-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.RESEND_API_KEY = 're_test_not_a_real_key';
process.env.SUPABASE_JWT_SECRET = 'test-supabase-secret';
process.env.VHI_TEST_SETUP = '1';
