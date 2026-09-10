-- Widen weight_unit so container units (e.g. '20ft container') can be stored.
-- Client forms send weights in kg/lb/cbm or container sizes; VARCHAR(10) was too short.
ALTER TABLE shipments
  ALTER COLUMN weight_unit TYPE VARCHAR(30);

ALTER TABLE cargo_clearings
  ALTER COLUMN weight_unit TYPE VARCHAR(30);