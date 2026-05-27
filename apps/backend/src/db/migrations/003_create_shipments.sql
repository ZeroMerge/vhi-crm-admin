CREATE TYPE shipping_mode_enum AS ENUM (
  'air_freight','groupage','consolidation','china_groupage','cargo_clearing','export'
);
CREATE TYPE delivery_mode_enum AS ENUM (
  'door_to_door','port_to_port','port_to_door','clearance_only','office_pickup','airport_pickup'
);
CREATE TYPE shipment_status_enum AS ENUM (
  'draft','pending','processing','in_transit','clearance','delivered','cancelled'
);
CREATE TYPE pickup_option_enum AS ENUM ('vhi_pickup','supplier_dropoff');

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
