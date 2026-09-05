# PostgreSQL Database Schema — VHI CRM

**Database**: `vhi_crm`  
**Driver**: Node.js `pg` (PostgreSQL pool)  
**Provider**: Supabase  
**Config**: `apps/backend/src/config/db.ts`  
**Migrations**: `apps/backend/src/db/migrations/` (001 → 012)

---

## Custom Enum Types

| Enum | Values |
|------|--------|
| `industry_enum` | `oil_gas`, `medical`, `pharma`, `agricultural`, `manufacturing`, `mining`, `others` |
| `customer_status_enum` | `lead`, `prospect`, `returning`, `loyal` |
| `admin_role_enum` | `super_admin`, `manager`, `staff` |
| `shipping_mode_enum` | `air_freight`, `groupage`, `consolidation`, `china_groupage`, `cargo_clearing`, `export` |
| `delivery_mode_enum` | `door_to_door`, `port_to_port`, `port_to_door`, `clearance_only`, `office_pickup`, `airport_pickup` |
| `shipment_status_enum` | `draft`, `pending`, `processing`, `in_transit`, `clearance`, `delivered`, `cancelled` |
| `pickup_option_enum` | `vhi_pickup`, `supplier_dropoff` |
| `dimension_unit_enum` | `mm`, `cm`, `inches` |
| `document_type_enum` | `awb`, `bol`, `form_m`, `paar`, `packing_list`, `proforma_invoice`, `other` |
| `invoice_status_enum` | `draft`, `sent`, `pending`, `awaiting_vendor`, `awaiting_vendor_feedback`, `part_paid`, `paid` |
| `payment_method_enum` | `paystack`, `stripe`, `manual` |
| `payment_status_enum` | `pending`, `success`, `failed` |

---

## Tables

### 1. `customers`

> Migration: `001_create_customers.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `user_id` | `VARCHAR(20)` | UNIQUE, NOT NULL |
| `firstname` | `VARCHAR(100)` | NOT NULL |
| `lastname` | `VARCHAR(100)` | NOT NULL |
| `email` | `VARCHAR(255)` | UNIQUE, NOT NULL |
| `phone` | `VARCHAR(30)` | — |
| `industry` | `industry_enum` | — |
| `password_hash` | `VARCHAR(255)` | NOT NULL |
| `star_rating` | `INT` | DEFAULT `1`, CHECK (1–5) |
| `status` | `customer_status_enum` | DEFAULT `'lead'` |
| `newsletter_prefs` | `JSONB` | DEFAULT `'[]'` |
| `is_active` | `BOOLEAN` | DEFAULT `false` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 2. `admins`

> Migration: `002_create_admins.sql` | Updated: `011_update_admins_and_audit.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `name` | `VARCHAR(150)` | NOT NULL |
| `email` | `VARCHAR(255)` | UNIQUE, NOT NULL |
| `password_hash` | `VARCHAR(255)` | NOT NULL |
| `role` | `admin_role_enum` | DEFAULT `'staff'` |
| `assigned_roles` | `TEXT[]` | DEFAULT `ARRAY['support_staff']` |
| `notification_prefs` | `JSONB` | DEFAULT `'{}'` |
| `is_active` | `BOOLEAN` | DEFAULT `true` |
| `deleted_at` | `TIMESTAMPTZ` | — (soft delete) |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 3. `shipments`

> Migration: `003_create_shipments.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `order_id` | `VARCHAR(30)` | UNIQUE, NOT NULL |
| `customer_id` | `UUID` | FK → `customers(id)` ON DELETE CASCADE |
| `shipping_mode` | `shipping_mode_enum` | NOT NULL |
| `delivery_mode` | `delivery_mode_enum` | — |
| `nature_of_item` | `TEXT` | — |
| `hs_code` | `VARCHAR(30)` | — |
| `invoice_value` | `DECIMAL(15,2)` | — |
| `invoice_currency` | `VARCHAR(10)` | DEFAULT `'USD'` |
| `weight` | `DECIMAL(10,3)` | — |
| `weight_unit` | `VARCHAR(10)` | DEFAULT `'kg'` |
| `origin_address` | `TEXT` | — |
| `destination_address` | `TEXT` | — |
| `origin_pickup_option` | `pickup_option_enum` | — |
| `port_of_discharge` | `VARCHAR(100)` | — |
| `awb_number` | `VARCHAR(100)` | — |
| `bol_number` | `VARCHAR(100)` | — |
| `unique_id` | `VARCHAR(100)` | — |
| `status` | `shipment_status_enum` | DEFAULT `'draft'` |
| `is_draft` | `BOOLEAN` | DEFAULT `true` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 4. `shipment_items`

> Migration: `004_create_shipment_items.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `shipment_id` | `UUID` | FK → `shipments(id)` ON DELETE CASCADE |
| `description` | `VARCHAR(255)` | — |
| `category` | `VARCHAR(100)` | — |
| `quantity` | `INT` | DEFAULT `1` |
| `weight` | `DECIMAL(10,3)` | — |
| `dimension_l` | `DECIMAL(10,2)` | — |
| `dimension_w` | `DECIMAL(10,2)` | — |
| `dimension_h` | `DECIMAL(10,2)` | — |
| `dimension_unit` | `dimension_unit_enum` | DEFAULT `'cm'` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 5. `tracking_updates`

> Migration: `005_create_tracking_updates.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `shipment_id` | `UUID` | FK → `shipments(id)` ON DELETE CASCADE |
| `status` | `VARCHAR(100)` | NOT NULL |
| `message` | `TEXT` | — |
| `updated_by` | `UUID` | FK → `admins(id)` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 6. `shipment_documents`

> Migration: `006_create_shipment_documents.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `shipment_id` | `UUID` | FK → `shipments(id)` ON DELETE CASCADE |
| `document_type` | `document_type_enum` | DEFAULT `'other'` |
| `file_url` | `TEXT` | NOT NULL |
| `uploaded_by` | `VARCHAR(20)` | DEFAULT `'admin'` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 7. `invoices`

> Migration: `007_create_invoices.sql` | Updated: `012_missing_features.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `invoice_number` | `VARCHAR(30)` | UNIQUE, NOT NULL |
| `shipment_id` | `UUID` | FK → `shipments(id)` |
| `customer_id` | `UUID` | FK → `customers(id)` |
| `amount` | `DECIMAL(15,2)` | NOT NULL |
| `currency` | `VARCHAR(10)` | DEFAULT `'NGN'` |
| `status` | `invoice_status_enum` | DEFAULT `'draft'` |
| `due_date` | `DATE` | — |
| `follow_up_date` | `TIMESTAMPTZ` | — (added migration 012) |
| `notes` | `TEXT` | — |
| `file_url` | `TEXT` | — |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 8. `payments`

> Migration: `008_create_payments.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `invoice_id` | `UUID` | FK → `invoices(id)` |
| `customer_id` | `UUID` | FK → `customers(id)` |
| `amount` | `DECIMAL(15,2)` | NOT NULL |
| `currency` | `VARCHAR(10)` | DEFAULT `'NGN'` |
| `payment_method` | `payment_method_enum` | — |
| `payment_status` | `payment_status_enum` | DEFAULT `'pending'` |
| `gateway_reference` | `VARCHAR(255)` | — |
| `receipt_url` | `TEXT` | — |
| `paid_at` | `TIMESTAMPTZ` | — |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 9. `communications`

> Migration: `009_create_communications.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `customer_id` | `UUID` | FK → `customers(id)` ON DELETE CASCADE |
| `sent_by` | `UUID` | FK → `admins(id)` |
| `subject` | `VARCHAR(255)` | — |
| `body` | `TEXT` | NOT NULL |
| `is_read` | `BOOLEAN` | DEFAULT `false` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 10. `newsletter_sends`

> Migration: `010_create_newsletter.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `subject` | `VARCHAR(255)` | NOT NULL |
| `body` | `TEXT` | NOT NULL |
| `segment` | `VARCHAR(100)` | DEFAULT `'all'` |
| `sent_by` | `UUID` | FK → `admins(id)` |
| `recipient_count` | `INT` | DEFAULT `0` |
| `sent_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 11. `audit_logs`

> Migration: `011_update_admins_and_audit.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `admin_id` | `UUID` | FK → `admins(id)` ON DELETE SET NULL |
| `active_role` | `VARCHAR(50)` | — |
| `action` | `VARCHAR(255)` | — (e.g. `'UPDATE_SHIPMENT_STATUS'`) |
| `resource_type` | `VARCHAR(100)` | — (e.g. `'shipment'`) |
| `resource_id` | `UUID` | — |
| `metadata` | `JSONB` | — |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

### 12. `customer_feedback`

> Migration: `012_missing_features.sql`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `customer_id` | `UUID` | FK → `customers(id)` ON DELETE CASCADE |
| `rating` | `INTEGER` | CHECK (1–5) |
| `message` | `TEXT` | — |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

## Entity Relationship Diagram

```
customers (1) ──────────────────────────────────────────────────────────────
  │                                                                          │
  ├─(1:N)─► shipments (1)                              (1:N)─► payments     │
  │             │                                                            │
  │             ├─(1:N)─► shipment_items                                    │
  │             ├─(1:N)─► shipment_documents                                │
  │             ├─(1:N)─► tracking_updates ◄──(sent_by)── admins           │
  │             └─(1:N)─► invoices (1) ─(1:N)─► payments                   │
  │                                                                          │
  ├─(1:N)─► invoices ◄─────────────────────────────────────────────────────┘
  ├─(1:N)─► payments
  ├─(1:N)─► communications ◄──(sent_by)── admins
  └─(1:N)─► customer_feedback

admins (1)
  ├─(1:N)─► tracking_updates   (updated_by)
  ├─(1:N)─► communications     (sent_by)
  ├─(1:N)─► newsletter_sends   (sent_by)
  └─(1:N)─► audit_logs         (admin_id, ON DELETE SET NULL)
```

---

## Key Design Notes

| Feature | Detail |
|---------|--------|
| **Primary Keys** | All tables use UUID via `uuid_generate_v4()` |
| **Timestamps** | All tables have `created_at`; mutable tables also have `updated_at` |
| **Soft Deletes** | `admins.deleted_at` — null means active |
| **Cascade Deletes** | Child records of `customers` and `shipments` cascade on parent delete |
| **JSONB Columns** | `newsletter_prefs` (customers), `notification_prefs` (admins), `metadata` (audit_logs) |
| **Type Safety** | Eleven PostgreSQL ENUM types enforce domain values at the DB layer |
| **Financial Precision** | `DECIMAL(15,2)` for amounts; `DECIMAL(10,3)` for weights |
| **Audit Trail** | `audit_logs` records every admin action with resource type, resource ID, and JSONB metadata |
| **Role System** | Admins have a static `role` (enum) and a dynamic `assigned_roles` (TEXT[]) array |
