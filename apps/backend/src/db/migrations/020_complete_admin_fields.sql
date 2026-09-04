-- Complete the admin fields used by authentication and admin management routes.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_active_role VARCHAR(50);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
