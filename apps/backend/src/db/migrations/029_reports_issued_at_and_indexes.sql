-- Reports overhaul: invoices.issued_at plus the indexes the report queries use. Plain Postgres only.

-- issued_at = when an invoice first left 'draft'. Set once, never changed afterwards (see the trigger below).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

-- Backfill: existing non-draft invoices were issued when they were created (the only date we have).
-- Invoices that were drafts and later left draft before this migration also get created_at: their real issue time was never recorded.
UPDATE invoices SET issued_at = created_at WHERE issued_at IS NULL AND status <> 'draft';

-- A trigger (not route code) so every writer is covered: the status route, the payment route, seeds, manual SQL.
--  * INSERT with a non-draft status and no issued_at: issued at creation time.
--  * UPDATE: the first change away from draft stamps NOW(); an existing issued_at can never be changed or cleared.
CREATE OR REPLACE FUNCTION set_invoice_issued_at() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.issued_at IS NOT NULL THEN
    NEW.issued_at := OLD.issued_at;
  ELSIF NEW.issued_at IS NULL AND NEW.status <> 'draft' THEN
    NEW.issued_at := COALESCE(NEW.created_at, NOW());
    IF TG_OP = 'UPDATE' THEN NEW.issued_at := NOW(); END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_set_issued_at ON invoices;
CREATE TRIGGER invoices_set_issued_at
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_invoice_issued_at();

-- Report indexes (docs/SCHEMA.md "Missing indexes"). Partial where the reports exclude the rest anyway.
CREATE INDEX IF NOT EXISTS shipments_customer_idx        ON shipments (customer_id);
CREATE INDEX IF NOT EXISTS shipments_created_nondraft_idx ON shipments (created_at) WHERE status <> 'draft';
CREATE INDEX IF NOT EXISTS shipments_closed_changed_idx  ON shipments (status_changed_at) WHERE status IN ('delivered', 'cancelled');
CREATE INDEX IF NOT EXISTS invoices_issued_at_idx        ON invoices (issued_at) WHERE issued_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_customer_idx         ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS invoices_shipment_idx         ON invoices (shipment_id);
-- Collected is dated by COALESCE(paid_at, created_at): the expression must match the report query exactly.
CREATE INDEX IF NOT EXISTS payments_success_paid_idx     ON payments ((COALESCE(paid_at, created_at))) WHERE payment_status = 'success';
CREATE INDEX IF NOT EXISTS payments_success_invoice_idx  ON payments (invoice_id) WHERE payment_status = 'success';
