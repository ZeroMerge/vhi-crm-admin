CREATE TABLE IF NOT EXISTS cargo_clearings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id       UUID REFERENCES customers(id) ON DELETE CASCADE,
  clearing_type     VARCHAR(20) NOT NULL,
  description       TEXT NOT NULL,
  awb_number        VARCHAR(100),
  invoice_value     DECIMAL(15,2) DEFAULT 0,
  invoice_currency  VARCHAR(10) DEFAULT 'NGN',
  commodity_hs_code VARCHAR(50),
  weight            DECIMAL(10,3),
  weight_unit       VARCHAR(10) DEFAULT 'kg',
  delivery_mode     VARCHAR(50),
  delivery_address  TEXT,
  status            VARCHAR(20) DEFAULT 'pending',
  airway_bill_url   TEXT,
  final_invoice_url TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
