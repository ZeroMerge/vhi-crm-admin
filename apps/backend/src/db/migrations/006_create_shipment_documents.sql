CREATE TYPE document_type_enum AS ENUM (
  'awb','bol','form_m','paar','packing_list','proforma_invoice','other'
);

CREATE TABLE IF NOT EXISTS shipment_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  document_type document_type_enum DEFAULT 'other',
  file_url TEXT NOT NULL,
  uploaded_by VARCHAR(20) DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
