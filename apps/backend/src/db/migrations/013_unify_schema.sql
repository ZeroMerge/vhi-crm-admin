-- Swap medical + pharma → medical_pharma in industry_enum.
-- Wrapped in a DO block guarded by whether the old values still exist,
-- so this is fully safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'industry_enum'
      AND e.enumlabel IN ('medical', 'pharma')
  ) THEN
    -- Detach column from the enum first so we can update and drop freely.
    ALTER TABLE customers ALTER COLUMN industry TYPE VARCHAR(50);

    UPDATE customers
      SET industry = 'medical_pharma'
      WHERE industry IN ('medical', 'pharma');

    DROP TYPE industry_enum;

    CREATE TYPE industry_enum AS ENUM (
      'oil_gas', 'medical_pharma', 'agricultural', 'manufacturing', 'mining', 'others'
    );

    ALTER TABLE customers ALTER COLUMN industry TYPE industry_enum
      USING industry::industry_enum;
  END IF;
END
$$;

-- Add new columns to shipments (all guarded with IF NOT EXISTS)
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS country_of_origin     VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ex_work_type          VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_email          VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_phone          VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS destination_email     VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS destination_phone     VARCHAR(255);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipment_verified_at  TIMESTAMPTZ;
