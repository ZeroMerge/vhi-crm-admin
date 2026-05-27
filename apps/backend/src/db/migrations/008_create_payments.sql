CREATE TYPE payment_method_enum AS ENUM ('paystack','stripe','manual');
CREATE TYPE payment_status_enum AS ENUM ('pending','success','failed');

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id),
  customer_id UUID REFERENCES customers(id),
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'NGN',
  payment_method payment_method_enum,
  payment_status payment_status_enum DEFAULT 'pending',
  gateway_reference VARCHAR(255),
  receipt_url TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
