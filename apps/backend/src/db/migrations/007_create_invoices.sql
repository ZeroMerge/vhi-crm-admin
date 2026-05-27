CREATE TYPE invoice_status_enum AS ENUM (
  'draft','sent','pending','awaiting_vendor','part_paid','paid'
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number VARCHAR(30) UNIQUE NOT NULL,
  shipment_id UUID REFERENCES shipments(id),
  customer_id UUID REFERENCES customers(id),
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'NGN',
  status invoice_status_enum DEFAULT 'draft',
  due_date DATE,
  notes TEXT,
  file_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
