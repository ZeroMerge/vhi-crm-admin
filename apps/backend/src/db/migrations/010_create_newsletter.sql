CREATE TABLE IF NOT EXISTS newsletter_sends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  segment VARCHAR(100) DEFAULT 'all',
  sent_by UUID REFERENCES admins(id),
  recipient_count INT DEFAULT 0,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
