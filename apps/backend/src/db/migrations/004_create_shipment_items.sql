CREATE TYPE dimension_unit_enum AS ENUM ('mm','cm','inches');

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
