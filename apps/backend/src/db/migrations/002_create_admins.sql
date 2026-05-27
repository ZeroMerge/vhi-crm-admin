CREATE TYPE admin_role_enum AS ENUM ('super_admin','manager','staff');

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role admin_role_enum DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
