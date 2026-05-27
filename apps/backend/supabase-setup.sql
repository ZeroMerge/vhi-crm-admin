CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE industry_enum AS ENUM ('oil_gas','medical','pharma','agricultural','manufacturing','mining','others');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE customer_status_enum AS ENUM ('lead','prospect','returning','loyal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE admin_role_enum AS ENUM ('super_admin','manager','staff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE shipping_mode_enum AS ENUM ('air_freight','groupage','consolidation','china_groupage','cargo_clearing','export');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE delivery_mode_enum AS ENUM ('door_to_door','port_to_port','port_to_door','clearance_only','office_pickup','airport_pickup');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status_enum AS ENUM ('draft','pending','processing','in_transit','clearance','delivered','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE pickup_option_enum AS ENUM ('vhi_pickup','supplier_dropoff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dimension_unit_enum AS ENUM ('mm','cm','inches');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE document_type_enum AS ENUM ('awb','bol','form_m','paar','packing_list','proforma_invoice','other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status_enum AS ENUM ('draft','sent','pending','awaiting_vendor','part_paid','paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method_enum AS ENUM ('paystack','stripe','manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('pending','success','failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(20) UNIQUE NOT NULL,
  firstname VARCHAR(100) NOT NULL,
  lastname VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(30),
  industry industry_enum,
  password_hash VARCHAR(255) NOT NULL,
  star_rating INT DEFAULT 1 CHECK (star_rating BETWEEN 1 AND 5),
  status customer_status_enum DEFAULT 'lead',
  newsletter_prefs JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role admin_role_enum DEFAULT 'staff',
  assigned_roles TEXT[] DEFAULT ARRAY['support_staff'],
  notification_prefs JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id VARCHAR(30) UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  shipping_mode shipping_mode_enum NOT NULL,
  delivery_mode delivery_mode_enum,
  nature_of_item TEXT,
  hs_code VARCHAR(30),
  invoice_value DECIMAL(15,2),
  invoice_currency VARCHAR(10) DEFAULT 'USD',
  weight DECIMAL(10,3),
  weight_unit VARCHAR(10) DEFAULT 'kg',
  origin_address TEXT,
  destination_address TEXT,
  origin_pickup_option pickup_option_enum,
  port_of_discharge VARCHAR(100),
  awb_number VARCHAR(100),
  bol_number VARCHAR(100),
  unique_id VARCHAR(100),
  status shipment_status_enum DEFAULT 'draft',
  is_draft BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  description VARCHAR(255),
  category VARCHAR(100),
  quantity INT DEFAULT 1,
  weight DECIMAL(10,3),
  dimension_l DECIMAL(10,2),
  dimension_w DECIMAL(10,2),
  dimension_h DECIMAL(10,2),
  dimension_unit dimension_unit_enum DEFAULT 'cm',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  status VARCHAR(100) NOT NULL,
  message TEXT,
  updated_by UUID REFERENCES admins(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  document_type document_type_enum DEFAULT 'other',
  file_url TEXT NOT NULL,
  uploaded_by VARCHAR(20) DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS communications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  sent_by UUID REFERENCES admins(id),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS newsletter_sends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  segment VARCHAR(100) DEFAULT 'all',
  sent_by UUID REFERENCES admins(id),
  recipient_count INT DEFAULT 0,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  active_role VARCHAR(50),
  action VARCHAR(255),
  resource_type VARCHAR(100),
  resource_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO admins (name, email, password_hash, role, assigned_roles, notification_prefs, is_active)
VALUES (
  'VHI Admin',
  'admin@valuehandlers.com',
  '$2a$10$Pg47yHL1vpply3E1NIiHHuvNQ2W/1/hq2.EvdgiE3g6.95j0Mp2ka',
  'super_admin',
  ARRAY['super_admin']::text[],
  '{}'::jsonb,
  true
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO customers (user_id, firstname, lastname, email, phone, industry, password_hash, star_rating, status, is_active)
VALUES
  ('USR001', 'Jane', 'Smith', 'jane@vhi.com', '+2348012345678', 'oil_gas', '$2a$10$FhgzaVZLaKvKpx8Hl8rDE.2L.Gh.uQxaw6R4a6BriBMkL.lYhLBr6', 4, 'loyal', true),
  ('USR002', 'John', 'Doe', 'john@vhi.com', '+2348023456789', 'medical', '$2a$10$FhgzaVZLaKvKpx8Hl8rDE.2L.Gh.uQxaw6R4a6BriBMkL.lYhLBr6', 3, 'prospect', true),
  ('USR003', 'Sarah', 'Lee', 'sarah@vhi.com', '+2348034567890', 'pharma', '$2a$10$FhgzaVZLaKvKpx8Hl8rDE.2L.Gh.uQxaw6R4a6BriBMkL.lYhLBr6', 5, 'loyal', true),
  ('USR004', 'Mike', 'Brown', 'mike@vhi.com', '+2348045678901', 'manufacturing', '$2a$10$FhgzaVZLaKvKpx8Hl8rDE.2L.Gh.uQxaw6R4a6BriBMkL.lYhLBr6', 2, 'lead', true),
  ('USR005', 'Lisa', 'Wang', 'lisa@vhi.com', '+2348056789012', 'mining', '$2a$10$FhgzaVZLaKvKpx8Hl8rDE.2L.Gh.uQxaw6R4a6BriBMkL.lYhLBr6', 4, 'returning', true)
ON CONFLICT (email) DO NOTHING;

WITH c AS (
  SELECT id, email FROM customers
), s AS (
  INSERT INTO shipments (order_id, customer_id, shipping_mode, delivery_mode, nature_of_item, invoice_value, invoice_currency, weight, origin_address, destination_address, awb_number, bol_number, unique_id, status, is_draft)
  VALUES
    ('#1895-67-fw', (SELECT id FROM c WHERE email = 'jane@vhi.com'), 'air_freight', 'door_to_door', 'Building material', 34000000, 'NGN', 365000, '45 Oxford Street, London, UK', '12 Vaclavske namesti, Prague, Czech Republic', '157-12345670', NULL, NULL, 'delivered', false),
    ('#2695-77-gw', (SELECT id FROM c WHERE email = 'john@vhi.com'), 'groupage', 'port_to_port', 'Electronics', 12500000, 'NGN', 50000, 'Berlin, Germany', 'Lagos, Nigeria', NULL, 'BOL-2024-002', NULL, 'in_transit', false),
    ('#3456-66-fw', (SELECT id FROM c WHERE email = 'sarah@vhi.com'), 'consolidation', 'door_to_door', 'Medical Supplies', 8900000, 'NGN', 12000, 'Paris, France', 'Cairo, Egypt', NULL, NULL, NULL, 'pending', false),
    ('#4521-89-ac', (SELECT id FROM c WHERE email = 'mike@vhi.com'), 'cargo_clearing', 'clearance_only', 'Agricultural Equipment', 45600000, 'NGN', 200000, 'New York, USA', 'Accra, Ghana', NULL, NULL, NULL, 'processing', false),
    ('#7823-12-bd', (SELECT id FROM c WHERE email = 'lisa@vhi.com'), 'export', 'port_to_port', 'Mining Equipment', 6700000, 'NGN', 80000, 'Beijing, China', 'Johannesburg, South Africa', NULL, NULL, NULL, 'delivered', false),
    ('#6234-45-ce', (SELECT id FROM c WHERE email = 'jane@vhi.com'), 'air_freight', 'airport_pickup', 'Pharmaceuticals', 15000000, 'NGN', 5000, 'Mumbai, India', 'Nairobi, Kenya', '157-98765432', NULL, NULL, 'delivered', false),
    ('#9012-78-df', (SELECT id FROM c WHERE email = 'john@vhi.com'), 'china_groupage', 'door_to_door', 'Textiles', 8200000, 'NGN', 45000, 'Guangzhou, China', 'Lagos, Nigeria', NULL, NULL, 'VHI-CN-001', 'in_transit', false),
    ('#3451-90-eg', (SELECT id FROM c WHERE email = 'sarah@vhi.com'), 'groupage', 'office_pickup', 'Auto Parts', 23000000, 'NGN', 95000, 'Tokyo, Japan', 'Cairo, Egypt', NULL, NULL, NULL, 'clearance', false),
    ('#1289-34-fh', (SELECT id FROM c WHERE email = 'mike@vhi.com'), 'air_freight', 'door_to_door', 'Chemicals', 18900000, 'NGN', 18000, 'Houston, USA', 'Lagos, Nigeria', '157-45678901', NULL, NULL, 'pending', false),
    ('#5678-23-gi', (SELECT id FROM c WHERE email = 'lisa@vhi.com'), 'consolidation', 'port_to_door', 'Machinery', 34200000, 'NGN', 150000, 'Seoul, South Korea', 'Accra, Ghana', NULL, NULL, NULL, 'delivered', false)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id
)
INSERT INTO invoices (invoice_number, shipment_id, customer_id, amount, currency, status, due_date)
VALUES
  ('INV-2024-001', (SELECT id FROM shipments WHERE order_id = '#1895-67-fw'), (SELECT id FROM customers WHERE email = 'jane@vhi.com'), 34000000, 'NGN', 'paid', '2024-03-30'),
  ('INV-2024-002', (SELECT id FROM shipments WHERE order_id = '#2695-77-gw'), (SELECT id FROM customers WHERE email = 'john@vhi.com'), 12500000, 'NGN', 'pending', '2024-04-20'),
  ('INV-2024-003', (SELECT id FROM shipments WHERE order_id = '#3456-66-fw'), (SELECT id FROM customers WHERE email = 'sarah@vhi.com'), 8900000, 'NGN', 'awaiting_vendor', '2024-05-15')
ON CONFLICT (invoice_number) DO NOTHING;