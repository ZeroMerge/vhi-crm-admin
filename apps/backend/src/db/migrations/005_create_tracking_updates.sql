CREATE TABLE IF NOT EXISTS tracking_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  status VARCHAR(100) NOT NULL,
  message TEXT,
  updated_by UUID REFERENCES admins(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
