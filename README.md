# VHI CRM Admin Panel

A comprehensive admin panel for ValueHandlers International (VHI) — a freight/logistics company. Built with React 18 + Vite + TypeScript frontend and Node.js + Express + PostgreSQL backend.

## Features

- **Dashboard Overview** — KPI cards, recent activities table with filtering, export
- **Customer Management** — Full CRUD, star ratings, status control, segmentation
- **Shipment Management** — Track shipments, upload documents, status timeline
- **Tracking** — Real-time tracking with AWB/BoL/Unique ID management
- **Invoices** — Create, manage, record payments, PDF generation
- **Communications** — Two-panel messaging interface with customers
- **Newsletter** — Compose and broadcast to industry segments
- **Audience Segmentation** — Manage customer segments
- **Reports** — Daily/weekly/monthly metrics with export
- **Settings** — Profile, password, notifications, admin management

## Tech Stack

### Frontend
- React 18 + TypeScript + Vite
- React Router v6
- Zustand (state management)
- Axios (HTTP client)
- Lucide React (icons)
- date-fns (date formatting)
- Plain CSS with CSS variables (no Tailwind)

### Backend
- Node.js + Express + TypeScript
- PostgreSQL (via `pg`)
- JWT authentication
- Paystack + Stripe payment integration
- Nodemailer (email)
- PDFKit (PDF generation)
- Multer + Cloudinary (file uploads)

## Project Structure

```
vhi-crm-admin/
├── app/                    # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/          # Reusable UI components
│   │   │   ├── layout/      # Sidebar, Topbar, PageWrapper
│   │   │   └── shared/      # ExportModal, etc.
│   │   ├── pages/           # All page components
│   │   ├── services/        # API services
│   │   ├── store/           # Zustand stores
│   │   ├── utils/           # Formatters
│   │   ├── types/           # TypeScript types
│   │   ├── styles/          # CSS tokens + globals
│   │   └── router/          # Route definitions
│   └── dist/                # Build output
├── apps/
│   └── backend/             # Express API
│       ├── src/
│       │   ├── config/      # DB, env
│       │   ├── middleware/  # Auth, error handling
│       │   ├── modules/     # Route modules
│       │   ├── db/migrations/ # SQL migrations
│       │   └── utils/       # Helpers
│       └── .env.example
└── README.md
```

## Setup Instructions

### Prerequisites
- Node.js 20+
- PostgreSQL 15+

### Frontend

```bash
cd app
npm install
npm run build        # Production build
npm run dev          # Development server
```

The frontend runs at `http://localhost:5173` by default.

### Backend

```bash
cd apps/backend
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials and secrets

# Run migrations
npm run db:migrate

# Seed data
npm run db:seed

# Start server
npm run dev          # Development (tsx)
npm run build        # Compile TypeScript
npm start            # Production
```

The backend runs at `http://localhost:5000` by default.

### Default Login
- **Email:** admin@valuehandlers.com
- **Password:** Admin@123

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 5000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_JWT_SECRET` | JWT secret for admin auth |
| `PAYSTACK_SECRET_KEY` | Paystack secret key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `SMTP_USER` | Gmail address for notifications |
| `SMTP_PASS` | Gmail app password |

## API Endpoints

### Auth
- `POST /api/auth/admin/login` — Admin login
- `POST /api/auth/admin/logout` — Logout
- `PUT /api/auth/admin/change-password` — Change password

### Customers
- `GET /api/admin/customers` — List with filters
- `GET /api/admin/customers/:id` — Detail
- `PUT /api/admin/customers/:id/star` — Update star rating
- `PUT /api/admin/customers/:id/status` — Update status
- `PUT /api/admin/customers/:id/segment` — Update segment

### Shipments
- `GET /api/admin/shipments` — List with filters
- `GET /api/admin/shipments/:id` — Detail with items/docs/tracking
- `PUT /api/admin/shipments/:id/status` — Update status
- `PUT /api/admin/shipments/:id/tracking` — Update tracking numbers
- `POST /api/admin/shipments/:id/documents` — Upload document

### Tracking
- `GET /api/admin/tracking/pending` — Pending tracking
- `POST /api/admin/tracking/:id/update` — Add tracking update
- `GET /api/tracking/:trackingId` — Public lookup

### Invoices
- `GET /api/admin/invoices` — List with filters
- `POST /api/admin/invoices` — Create invoice
- `PUT /api/admin/invoices/:id/status` — Update status
- `PUT /api/admin/invoices/:id/payment` — Record payment
- `GET /api/admin/invoices/:id/pdf` — Download PDF

### Payments
- `POST /api/payments/paystack/initialize` — Init Paystack
- `POST /api/payments/paystack/verify` — Verify Paystack
- `POST /api/payments/stripe/intent` — Create Stripe intent

### Communications
- `GET /api/admin/communications` — All conversations
- `GET /api/admin/communications/:customerId` — Thread
- `POST /api/admin/communications/send` — Send message

### Newsletter
- `GET /api/admin/newsletter/segments` — Segments
- `POST /api/admin/newsletter/send` — Send broadcast
- `GET /api/admin/newsletter/history` — History

### Reports
- `GET /api/admin/reports/:period` — Daily/weekly/monthly
- `GET /api/admin/reports/export` — Export CSV

## Database Migrations

Run migrations in order:
```bash
cd apps/backend
npm run db:migrate
```

Migrations are in `src/db/migrations/`:
1. `001_create_customers.sql`
2. `002_create_admins.sql`
3. `003_create_shipments.sql`
4. `004_create_shipment_items.sql`
5. `005_create_tracking_updates.sql`
6. `006_create_shipment_documents.sql`
7. `007_create_invoices.sql`
8. `008_create_payments.sql`
9. `009_create_communications.sql`
10. `010_create_newsletter.sql`

## License

Proprietary - ValueHandlers International Limited
