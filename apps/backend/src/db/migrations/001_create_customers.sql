CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE industry_enum AS ENUM (
  'oil_gas','medical','pharma','agricultural','manufacturing','mining','others'
);
CREATE TYPE customer_status_enum AS ENUM ('lead','prospect','returning','loyal');

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
