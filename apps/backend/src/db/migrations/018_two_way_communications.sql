-- Add explicit sender and independent read state for two-way portal messaging.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sent_by_customer UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS read_by_admin BOOLEAN,
  ADD COLUMN IF NOT EXISTS read_by_customer BOOLEAN;

UPDATE communications
SET sender_type = 'admin',
    read_by_admin = COALESCE(read_by_admin, true),
    read_by_customer = COALESCE(read_by_customer, false)
WHERE sender_type IS NULL;

ALTER TABLE communications
  ALTER COLUMN sender_type SET DEFAULT 'admin',
  ALTER COLUMN sender_type SET NOT NULL,
  ALTER COLUMN read_by_admin SET DEFAULT true,
  ALTER COLUMN read_by_admin SET NOT NULL,
  ALTER COLUMN read_by_customer SET DEFAULT false,
  ALTER COLUMN read_by_customer SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_sender_type_check') THEN
    ALTER TABLE communications ADD CONSTRAINT communications_sender_type_check
      CHECK (sender_type IN ('admin', 'customer'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS communications_customer_id_idx ON communications (customer_id);
CREATE INDEX IF NOT EXISTS communications_sender_type_idx ON communications (sender_type);
CREATE INDEX IF NOT EXISTS communications_admin_unread_idx ON communications (customer_id, read_by_admin)
  WHERE sender_type = 'customer' AND read_by_admin = false;
CREATE INDEX IF NOT EXISTS communications_customer_unread_idx ON communications (customer_id, read_by_customer)
  WHERE sender_type = 'admin' AND read_by_customer = false;
