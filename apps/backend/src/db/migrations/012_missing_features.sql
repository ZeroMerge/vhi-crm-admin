-- 3.1 Add awaiting_vendor_feedback to invoice_status_enum
ALTER TYPE invoice_status_enum ADD VALUE IF NOT EXISTS 'awaiting_vendor_feedback';

-- 3.2 Add follow_up_date to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ;

-- 3.4 Create customer_feedback table
CREATE TABLE IF NOT EXISTS customer_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
