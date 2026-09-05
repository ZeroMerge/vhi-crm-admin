# VHI CRM — CLAUDE.md

ValueHandlers International logistics CRM. Monorepo with React admin frontend and Node.js + PostgreSQL backend.

---

## Architecture

### Stack

| Layer | Tech |
|---|---|
| Admin frontend | React 18 + Vite + TypeScript (`/app`) |
| Client frontend | React (separate app, TBD path) |
| Backend API | Node.js + Express + TypeScript (`/apps/backend`) |
| Database | PostgreSQL on Supabase (`pg` driver, no ORM) |
| Auth | Custom JWT (`bcryptjs` + `jsonwebtoken`) |
| File storage | Multer (memory storage) → Cloudinary |
| PDF | PDFKit |
| Payments | Paystack + Stripe |
| Email | Resend SDK |
| Validation | Zod |

### Key decisions

- **Laravel + MySQL are dropped entirely.** The Node.js backend is the single API for both admin and client React apps.
- Both frontends call the Node.js API directly — no Laravel proxy, no separate backend per client.
- No ORM. All queries are raw parameterized SQL via `pg`.
- No data migration from MySQL. The app is in early development; PostgreSQL starts fresh.
- Export shipments are **not** a separate endpoint — they are regular shipments submitted with `shippingMode: 'export'` via `POST /api/client/shipments`.

---

## Project Structure

```
vhi-crm-admin/
├── app/                        # Admin React (Vite) frontend
│   └── src/
│       ├── components/
│       │   ├── ui/             # Stateless: Button, Input, Badge, Modal…
│       │   ├── layout/         # Topbar, Sidebar, PageWrapper
│       │   └── shared/         # Composite: ExportModal, StatusDropdown…
│       ├── pages/              # Route-level page components
│       ├── services/           # Axios API calls
│       ├── store/              # Zustand (authStore, uiStore, notificationStore)
│       ├── types/              # TypeScript types
│       ├── styles/             # globals.css, tokens.css (CSS variables only)
│       └── router/             # Route definitions + AdminRoute guard
├── apps/
│   └── backend/                # Express API
│       └── src/
│           ├── index.ts        # App entry, middleware, route mounting
│           ├── config/
│           │   ├── db.ts               # pg Pool — exports pool + query helper
│           │   └── cloudinary.ts       # Cloudinary SDK init (uses env vars)
│           ├── middleware/
│           │   ├── adminMiddleware.ts   # JWT verify, RBAC, req.admin
│           │   ├── customerMiddleware.ts # JWT verify, req.customer
│           │   └── errorHandler.ts     # Global catch-all
│           ├── modules/        # Feature modules (one *.routes.ts each)
│           │   ├── auth/
│           │   ├── admin/
│           │   ├── customers/
│           │   ├── shipments/
│           │   ├── tracking/
│           │   ├── invoices/
│           │   ├── payments/
│           │   ├── communications/
│           │   ├── newsletter/
│           │   ├── reports/
│           │   ├── feedback/
│           │   ├── search/
│           │   └── client/             # Client-facing routes
│           │       ├── client.auth.routes.ts
│           │       ├── client.shipments.routes.ts
│           │       └── client.cargo.routes.ts
│           ├── utils/
│           │   ├── audit.ts            # logAuditEvent()
│           │   ├── sendEmail.ts        # Resend SDK wrapper
│           │   ├── generateOrderId.ts  # accepts source: 'admin' | 'client'
│           │   └── uploadToCloudinary.ts  # Multer file → Cloudinary; returns { url, publicId }
│           └── db/
│               ├── migrate.ts          # Runs all .sql files in order
│               ├── seed.ts             # Test data (idempotent upserts)
│               └── migrations/         # 001 → 015 sequential SQL files
└── CLAUDE.md
```

---

## Database

### Migration runner

Migrations live in `apps/backend/src/db/migrations/` and are run in filename order by `migrate.ts`. Always add new migrations as the next numbered file — never edit existing ones.

```bash
cd apps/backend
npm run db:migrate
npm run db:seed     # populates test admins, customers, shipments, invoices
```

### Migration history

| # | File | Purpose |
|---|---|---|
| 001 | `create_customers` | `customers` table, `industry_enum`, `customer_status_enum` |
| 002 | `create_admins` | `admins` table, `admin_role_enum` |
| 003 | `create_shipments` | `shipments` table + enums for mode/delivery/status |
| 004 | `create_shipment_items` | `shipment_items`, `dimension_unit_enum` |
| 005 | `create_tracking_updates` | `tracking_updates` |
| 006 | `create_shipment_documents` | `shipment_documents`, `document_type_enum` |
| 007 | `create_invoices` | `invoices`, `invoice_status_enum` |
| 008 | `create_payments` | `payments`, `payment_method_enum`, `payment_status_enum` |
| 009 | `create_communications` | `communications` |
| 010 | `create_newsletter` | `newsletter_sends` |
| 011 | `update_admins_and_audit` | Adds `assigned_roles[]`, `notification_prefs` to admins; creates `audit_logs` |
| 012 | `missing_features` | Adds `awaiting_vendor_feedback` to invoice enum; `customer_feedback` table |
| 013 | `unify_schema` | Merges `medical`+`pharma` → `medical_pharma`; extends `shipments` with 7 client-side columns |
| 014 | `create_email_verification_tokens` | Token table for email verification (reusable for password reset) |
| 015 | `extend_audit_logs` | Makes `admin_id` nullable; adds `customer_id`, `actor_type` to support customer-initiated audit events |
| 016 | `add_cloudinary_public_id_to_documents` | Adds `cloudinary_public_id` to `shipment_documents` |
| 017 | `add_sea_freight_shipping_mode` | Adds `sea_freight` to `shipping_mode_enum` |
| 018 | `create_cargo_clearings` | `cargo_clearings` table for client-submitted air/sea cargo clearing requests |
| 019 | `add_type_to_email_verification_tokens` | Adds `type VARCHAR(30) DEFAULT 'email_verification'` to `email_verification_tokens`, enabling reuse for password reset (`type: 'password_reset'`) |

### Migration 013 — unify_schema

This migration reconciles the old MySQL domain with the new PostgreSQL schema:

1. **`industry_enum` consolidated**: `medical` and `pharma` are merged into `medical_pharma`. PostgreSQL doesn't support `DROP VALUE`, so the migration swaps via `ALTER COLUMN TYPE VARCHAR → DROP TYPE → CREATE TYPE → ALTER COLUMN TYPE industry_enum`.
2. **`shipments` extended** with seven new columns for client-side workflows:
   - `country_of_origin VARCHAR(255)`
   - `ex_work_type VARCHAR(255)`
   - `origin_email VARCHAR(255)`
   - `origin_phone VARCHAR(255)`
   - `destination_email VARCHAR(255)`
   - `destination_phone VARCHAR(255)`
   - `shipment_verified_at TIMESTAMPTZ`

### Migration 014 — create_email_verification_tokens

Creates a shared token table used for email verification on registration. Designed to be reused for password reset later by adding a `type` column in a future migration.

Table structure:
- `id UUID` PRIMARY KEY
- `customer_id UUID` FK → `customers(id)` ON DELETE CASCADE
- `token VARCHAR(255)` UNIQUE NOT NULL
- `expires_at TIMESTAMPTZ` NOT NULL
- `created_at TIMESTAMPTZ` DEFAULT NOW()

Token is deleted from this table after successful verification — no `used_at` column needed.

### Migration 015 — extend_audit_logs

Extends `audit_logs` to support both admin and customer-initiated actions in a single unified table:

- `admin_id` — made **nullable** (was previously required)
- `customer_id UUID` — new, FK → `customers(id)` ON DELETE SET NULL
- `actor_type VARCHAR(20) NOT NULL` — `'admin'` or `'customer'`; discriminates which ID field is populated

Every audit row has exactly one of `admin_id` / `customer_id` set, determined by `actor_type`.

### MySQL → PostgreSQL absorption map

| MySQL entity | PostgreSQL outcome |
|---|---|
| `users` | → `customers` table. No data migration; fresh start. |
| `exports` | → rows in `shipments` with `shipping_mode = 'export'` |
| `cargos` | → **deferred**; will become `cargo_clearings` table (see Pending Work) |

### Key enum values

```
industry_enum:        oil_gas, medical_pharma, agricultural, manufacturing, mining, others
shipping_mode_enum:   air_freight, groupage, consolidation, china_groupage, cargo_clearing, export
shipment_status_enum: draft, pending, processing, in_transit, clearance, delivered, cancelled
invoice_status_enum:  draft, sent, pending, awaiting_vendor, awaiting_vendor_feedback, part_paid, paid
```

All primary keys are UUID (`uuid_generate_v4()`). All timestamps are `TIMESTAMPTZ DEFAULT NOW()`.

---

## Backend Conventions

### Route pattern

Each module has exactly one `<feature>.routes.ts`. Logic lives inline — no separate controller or service files currently. Import `pool` from `../../config/db` for queries.

```typescript
import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { logAuditEvent } from '../../utils/audit';

const router = Router();

router.get('/', adminMiddleware, async (req, res, next) => {
  try {
    // ...
  } catch (err) { next(err); }
});

export default router;
```

### Response shape

All responses use this envelope — no exceptions:

```typescript
// success
res.json({ success: true, data: result.rows[0] });
res.status(201).json({ success: true, data: row });

// error (returned manually or via errorHandler)
res.status(404).json({ success: false, message: 'Not found' });

// paginated list
res.json({
  success: true,
  data: rows,
  pagination: { total, page, pageSize, totalPages },
});
```

### SQL query style

Raw parameterized SQL only. Dynamic queries use a running `paramIdx` counter:

```typescript
let sql = 'SELECT * FROM shipments WHERE 1=1';
const params: any[] = [];
let paramIdx = 1;

if (status) { sql += ` AND status = $${paramIdx}`; params.push(status); paramIdx++; }
if (search) {
  sql += ` AND (order_id ILIKE $${paramIdx} OR nature_of_item ILIKE $${paramIdx})`;
  params.push(`%${search}%`);
  paramIdx++;
}

sql += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
params.push(pageSize, (page - 1) * pageSize);

const result = await pool.query(sql, params);
```

Count queries wrap the filtered SQL in a subquery: `SELECT COUNT(*) FROM (${sql}) AS count_query`.

### Auth and RBAC

Every admin endpoint must use `adminMiddleware`. For role restrictions stack `requireActiveRole`:

```typescript
router.delete('/:id', adminMiddleware, requireActiveRole('super_admin', 'manager'), async (req, res, next) => { ... });
```

Roles: `super_admin` (full access), `manager`, `support_staff` (read-only — POST/PUT/DELETE blocked in middleware).

JWT payload on `req.admin`: `{ id, email, activeRole, assignedRoles }`. Secret: `ADMIN_JWT_SECRET` env var.

### Client Auth

- Client JWT is signed with `CLIENT_JWT_SECRET` env var (separate from `ADMIN_JWT_SECRET`)
- Middleware file: `customerMiddleware.ts` (mirrors adminMiddleware pattern)
- Verified token populates `req.customer`: `{ id, email, userId }`
- All protected client routes use `customerMiddleware` — never `adminMiddleware`
- Client routes mount under `/api/client/*`

### Email verification flow

1. `POST /api/client/auth/register` — creates customer with `is_active: false`, inserts token into `email_verification_tokens` with 24hr expiry, sends verification email via `sendEmail`
2. `GET /api/client/auth/verify-email?token=xxx` — looks up token, checks expiry, sets `is_active: true` on customer, deletes token row. Returns `410 Gone` for expired tokens so client can distinguish from invalid.
3. `POST /api/client/auth/login` — rejects with `401` if `is_active: false`

### File uploads

- Multer uses **memory storage** — files are held as buffers, never written to disk
- Max **4 files** per shipment submission (hard limit)
- Files are uploaded to Cloudinary **before** any DB transaction starts — if any upload fails, return `400` and abort; no DB writes occur
- If DB transaction fails after successful Cloudinary uploads, files become orphaned (acceptable tradeoff at this stage)
- Cloudinary config lives in `config/cloudinary.ts`
- Upload utility lives in `utils/uploadToCloudinary.ts` — accepts a `Multer.File`, returns `{ url: string, publicId: string }`
- Uploaded file URLs and public IDs are stored in `shipment_documents` table as part of the shipment creation transaction

### Shipment creation transaction order

For `POST /api/client/shipments`, the operation order is:

```
1. Validate all form fields (Zod)
2. Parse and validate items JSON string → array
3. Upload files to Cloudinary (max 4) — abort on any failure
4. BEGIN transaction
5. INSERT into shipments
6. INSERT into shipment_items (loop)
7. INSERT into shipment_documents (loop, using Cloudinary URLs from step 3)
8. COMMIT
9. logAuditEvent
10. Return 201
```

### Audit logging

`logAuditEvent` supports both admin and customer-initiated actions via `actorType`. Call it on every mutation — never skip it on either side.

```typescript
// admin action
await logAuditEvent({
  actorType: 'admin',
  actorId: req.admin!.id,
  activeRole: req.admin!.activeRole,
  action: 'UPDATE_SHIPMENT_STATUS',  // SCREAMING_SNAKE_CASE
  resourceType: 'shipment',
  resourceId: shipment.id,
  metadata: { orderId, customerId },
});

// customer action
await logAuditEvent({
  actorType: 'customer',
  actorId: req.customer!.id,
  action: 'CREATE_SHIPMENT',
  resourceType: 'shipment',
  resourceId: shipment.id,
  metadata: { orderId },
});
```

### API mount points

```
/api/auth/*                 → auth.routes (admin login, logout, me, switch-role)
/api/admin/admins/*         → admin_management.routes
/api/admin/customers/*      → customers.routes
/api/admin/shipments/*      → shipments.routes
/api/admin/tracking/*       → tracking.routes (admin)
/api/tracking/*             → tracking.routes (public — no auth)
/api/admin/invoices/*       → invoices.routes
/api/payments/*             → payments.routes (webhooks)
/api/admin/payments/*       → payments.routes
/api/admin/communications/* → communications.routes
/api/admin/newsletter/*     → newsletter.routes
/api/admin/reports/*        → reports.routes
/api/admin/feedback/*       → feedback.routes
/api/admin/search/*         → search.routes
/api/client/auth/*          → client auth routes (register, verify-email, login)
/api/client/shipments/*     → client shipment routes
/api/client/tracking/*      → client tracking routes
/api/client/cargo-clearings/* → client cargo clearing routes
/api/health                 → health check
```

### Naming conventions

- Route files: `<feature>.routes.ts`
- Middleware files: `<name>Middleware.ts`
- Request body: `camelCase` (`customerId`, `shippingMode`)
- DB columns: `snake_case` (`customer_id`, `shipping_mode`)
- Audit action strings: `SCREAMING_SNAKE_CASE` (`UPDATE_SHIPMENT_STATUS`)
- Order IDs: `#` prefix + source tag (`A` = admin, `C` = client) + 6-char base-36 timestamp, via `generateOrderId(source: 'admin' | 'client')` — e.g. `#A-1895-67-fw`, `#C-1895-67-fw`

---

## Frontend Conventions (Admin)

- **No Tailwind.** All styles use CSS custom properties defined in `styles/tokens.css` and `styles/globals.css`.
- **No global data store.** Fetched data lives in component `useState`/`useEffect` — only auth, UI state, and notifications go in Zustand.
- Icons: Lucide React (outline style).
- HTTP: Axios with an API service layer (`src/services/`).
- The `AdminRoute` wrapper enforces `rolePermissions.ts` — redirect unauthorized users to their allowed module.
- `support_staff` users are redirected away from Overview; role-specific landing pages are set at login.

---

## Environment Variables

```
PORT=5001
NODE_ENV=development
DATABASE_URL=postgresql://...           # Supabase pooler or local postgres
ADMIN_JWT_SECRET=<long-random-secret>
CLIENT_JWT_SECRET=<long-random-secret>
JWT_EXPIRES_IN=7d
ADMIN_FRONTEND_URL=http://localhost:3000
CLIENT_FRONTEND_URL=http://localhost:5173
RESEND_API_KEY=re_xxxxxxxxxx

# Optional
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Copy `.env.example` → `.env` and fill in values before running.

---

## Dev Commands

```bash
# Backend (from apps/backend/)
npm run dev          # tsx watch mode
npm run db:migrate   # run all pending migrations
npm run db:seed      # seed test data (idempotent)
npm run build        # tsc → dist/
npm start            # production (node dist/index.js)

# Frontend (from app/)
npm run dev          # Vite dev server (localhost:5173)
npm run build        # production build → dist/
```

Default test credentials (from seed):
- **admin@valuehandlers.com** / `Admin@123` (super_admin)

---

## Pending Work

The following is not yet implemented:

### 1. Client-side API endpoints (`/api/client/*`)

- ✅ `POST   /api/client/auth/register`       — customer registration (creates account, sends verification email)
- ✅ `GET    /api/client/auth/verify-email`    — email verification via token query param; 410 on expired
- ✅ `POST   /api/client/auth/login`           — customer login (JWT, blocks unverified accounts)
- ✅ `GET    /api/client/shipments`            — list own shipments, scoped to req.customer.id, paginated
- ✅ `POST   /api/client/shipments`            — create shipment + items + documents in correct order (see Shipment creation transaction order); export shipments use this same endpoint with `shippingMode: 'export'`
- ✅ `GET    /api/client/tracking/:orderId` — tracking visibility for own shipments
- ✅ `GET    /api/client/shipments/:orderId`  — shipment detail with nested items + tracking updates, scoped to req.customer.id
- ✅ `PUT    /api/client/shipments/:orderId`  — update a pending shipment (client-owned fields only); 403 once processing has begun
- ✅ `DELETE /api/client/shipments/:orderId`  — cancel a pending shipment (soft cancel — sets status, never deletes the row)
- ✅ `POST   /api/client/cargo-clearings`      — create cargo clearing submission (air/sea), optional AWB + invoice file uploads
- ✅ `GET    /api/client/cargo-clearings`      — list own cargo clearings, paginated
- ✅ `GET    /api/client/cargo-clearings/:id`  — single cargo clearing detail, scoped to req.customer.id
- ✅ `PUT    /api/client/cargo-clearings/:id`  — update a pending cargo clearing (client-owned fields only); 403 once processing has begun
- ✅ `DELETE /api/client/cargo-clearings/:id`  — cancel a pending cargo clearing (soft cancel — sets status, never deletes the row)
- ✅ `POST   /api/client/auth/forgot-password`  — always returns 200 regardless of account existence; emails a reset link only for active accounts
- ✅ `POST   /api/client/auth/reset-password`   — validates `email_verification_tokens` row with `type = 'password_reset'`; 410 on expired, deletes token on success

### 2. `cargo_clearings` table

Created in migration `018_create_cargo_clearings.sql`. MySQL `cargos` rows map here.

### 3. Password reset flow

Reuses `email_verification_tokens` table with a `type` column added in migration `019`. Implemented as `POST /api/client/auth/forgot-password` and `POST /api/client/auth/reset-password` (see above).

### 4. Client React update

The client-facing React app currently calls Laravel. It needs to be updated to call the Node.js API at the endpoints listed above once all backend endpoints are complete.