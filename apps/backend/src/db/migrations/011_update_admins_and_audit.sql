-- 011_update_admins_and_audit.sql
-- Migration to support role switching and action auditing

-- 1. Add new columns to admins table
ALTER TABLE admins ADD COLUMN IF NOT EXISTS assigned_roles TEXT[] DEFAULT ARRAY['support_staff'];
ALTER TABLE admins ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}';

-- 2. Migrate existing admin roles to the array format
UPDATE admins 
SET assigned_roles = 
  CASE 
    WHEN role::text = 'super_admin' THEN ARRAY['super_admin']::text[]
    WHEN role::text = 'manager' THEN ARRAY['manager']::text[]
    ELSE ARRAY['support_staff']::text[]
  END
WHERE assigned_roles = ARRAY['support_staff']::text[] OR assigned_roles IS NULL;

-- 3. Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  active_role VARCHAR(50),
  action VARCHAR(255),        -- e.g. 'UPDATE_SHIPMENT_STATUS'
  resource_type VARCHAR(100), -- e.g. 'shipment'
  resource_id UUID,
  metadata JSONB,             -- any extra context
  created_at TIMESTAMPTZ DEFAULT NOW()
);
