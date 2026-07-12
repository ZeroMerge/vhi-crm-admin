-- Make admin_id nullable so customer-actor rows can leave it NULL
ALTER TABLE audit_logs ALTER COLUMN admin_id DROP NOT NULL;

-- FK for customer-initiated actions
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- Distinguish who performed the action; default 'admin' backfills existing rows
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'admin';
