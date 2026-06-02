# VHI CRM Admin Panel - Comprehensive Technical Reference

This document provides an exhaustive, in-depth technical breakdown of the VHI CRM Admin Panel, a bespoke logistics management system built for ValueHandlers International (VHI).

---

## 1. System Architecture Overview

The system is a decoupled **Monorepo** consisting of a React Single Page Application (Frontend) and a Node.js/Express RESTful API (Backend). 

### 1.1 Tech Stack Deep-Dive
- **Frontend App (`/app`)**: 
  - **Framework:** React 18, TypeScript, Vite
  - **Routing:** React Router v6
  - **State Management:** Zustand (Auth, UI, Notifications)
  - **Data Fetching:** Axios
  - **Styling:** Custom CSS with CSS Variables (`globals.css`, `tokens.css`) - actively avoids Tailwind/utility classes.
  - **Icons:** Heroicons outline style
- **Backend API (`/apps/backend`)**:
  - **Framework:** Node.js, Express, TypeScript, `tsx` for dev
  - **Database Engine:** PostgreSQL hosted on Supabase (`pg` driver)
  - **Authentication:** Custom JWT with `bcryptjs`
  - **File Storage:** Multer + Cloudinary
  - **PDF Generation:** PDFKit
  - **Payment Gateways:** Paystack, Stripe
  - **Email Provider:** Nodemailer (SMTP)
  - **Validation:** Zod schemas

---

## 2. Database Schema Details (PostgreSQL)

The database relies heavily on native PostgreSQL ENUMs for strict data validation and relationships via UUIDs.

### Core Entities & Tables

#### 1. Users & Access Control
- **`admins`**: Stores admin credentials, names, assigned roles, and notification preferences. Uses `admin_role_enum` (`super_admin`, `manager`, `staff`).
- **`customers`**: Stores end-user data. Fields include `user_id` (e.g., 'USR001'), `firstname`, `lastname`, `industry`, `star_rating` (1-5), and `status` (lead, prospect, returning, loyal).
- **`audit_logs`**: Tracks admin actions across the system (action, resource type, resource ID, metadata).

#### 2. Shipments & Logistics
- **`shipments`**: The core operational table. Tracks `order_id`, `customer_id`, addresses, dimensions, and financial value.
  - **Enums utilized:** `shipping_mode_enum` (air_freight, groupage, consolidation, etc.), `delivery_mode_enum` (door_to_door, port_to_port, etc.), `shipment_status_enum` (draft, pending, processing, in_transit, clearance, delivered, cancelled).
- **`shipment_items`**: One-to-many relationship with shipments. Details individual items, quantities, weights, and dimensions (`dimension_unit_enum`).
- **`shipment_documents`**: Links files (uploaded to Cloudinary) to shipments via `document_type_enum` (awb, bol, form_m, paar, packing_list, proforma_invoice).
- **`tracking_updates`**: Appends chronological status messages to a shipment, viewable by customers.

#### 3. Financials
- **`invoices`**: Bound to `customer_id` and optionally `shipment_id`. Tracks `amount`, `currency`, `due_date`, and PDF file URLs. Uses `invoice_status_enum` (draft, sent, pending, part_paid, paid).
- **`payments`**: Records individual transaction attempts against an invoice. Uses `payment_method_enum` (paystack, stripe, manual) and `payment_status_enum` (pending, success, failed).

#### 4. Communications
- **`communications`**: Direct messaging threads between an admin and a specific `customer_id`. Tracks read receipts.
- **`newsletter_sends`**: Records broadcast emails sent to specific segments of users, tracking recipient counts and timestamps.

---

## 3. Backend Module Structure (`/apps/backend/src/modules`)

The backend is strictly modularized by domain. Each directory typically contains its own `controller.ts`, `service.ts`, `routes.ts`, and `schema.ts` (Zod validation).

1. **`auth/`**: Admin login, JWT generation, password management.
2. **`admin/`**: Admin profile and user management.
3. **`customers/`**: Customer CRUD, status/star-rating updates, and segmentation logic.
4. **`shipments/`**: Shipment creation, item management, document uploads (Multer -> Cloudinary), and status progressions.
5. **`tracking/`**: Public and private endpoints for fetching chronolical tracking updates by AWB/BoL or unique ID.
6. **`invoices/`**: Invoice generation, linking shipments, and on-the-fly PDF generation using PDFKit.
7. **`payments/`**: Webhook receivers and intent generators for Paystack and Stripe.
8. **`communications/`**: Fetching chat threads and dispatching direct emails via Nodemailer.
9. **`newsletter/`**: Segmenting users (e.g., "All Oil & Gas Customers") and broadcasting HTML emails.
10. **`reports/`**: Aggregating SQL data for Daily/Weekly/Monthly KPI metrics and CSV exports.
11. **`search/`**: Global search functionality across customers, shipments, and invoices.

---

## 4. Frontend Architecture (`/app/src`)

The React application is structured to handle complex admin workflows cleanly.

### 4.1 Page Routing (`/pages`)
- **`/auth`**: Login pages.
- **`/admin`**: The protected dashboard shell, utilizing `layout/Topbar` and `layout/Sidebar`.
  - **`Overview.tsx`**: The main dashboard. KPI cards and a horizontally scrolling recent activities table.
  - **`Customers/`**: Includes `CustomerList.tsx` (table view) and `CustomerDetail.tsx` (profile, history, messages).
  - **`Shipments/`**: Includes `ShipmentList.tsx`, `Compose.tsx` (creation wizard), and `ShipmentDetail.tsx` (timeline, docs, items).
  - **`Tracking.tsx`**: Dedicated view for managing and appending tracking updates.
  - **`Invoices/`**: `InvoiceList.tsx` and `InvoiceDetail.tsx` (payment recording, PDF viewer).
  - **`Communications.tsx`**: Two-panel chat interface mapping to customer email threads.
  - **`Newsletter/`**: `Compose.tsx` (WYSIWYG email editor) and `History.tsx`.
  - **`AudienceSegmentation.tsx`**: Rules engine for grouping customers.
  - **`Reports.tsx`**: Visual metrics, charts, and CSV export triggers.
  - **`Settings.tsx`**: Profile, notification preferences, and team/admin management.

### 4.2 State Management (`/store`)
Zustand is used for strictly global, ephemeral state:
- **`authStore.ts`**: Manages the `admin` user object, JWT token, and login/logout methods.
- **`uiStore.ts`**: Manages the mobile sidebar drawer state (open/close) and generic modal visibility.
- **`notificationStore.ts`**: Manages toast notifications and the topbar notification dropdown list.

*(Note: Data fetched from the API is generally stored in local component state (`useState`, `useEffect`) rather than global Zustand stores to prevent stale data in a highly concurrent CRM environment).*

### 4.3 UI Component Library (`/components`)
- **`ui/`**: Pure, stateless presentation components (`Button`, `Input`, `Select`, `Badge`, `Card`, `Modal`). These elements strictly follow the custom CSS token rules and do not use generic frameworks.
- **`layout/`**: `Topbar`, `Sidebar`, `PageWrapper`.
- **`shared/`**: Reusable complex components like `ExportModal`, `StatusDropdown`, or `Pagination`.

---

## 5. Build & Deployment Processes

- **Frontend:** Standard Vite build pipeline (`npm run build`). Outputs a static `dist` directory suitable for Vercel, Netlify, or S3.
- **Backend:** TypeScript compiler (`tsc`) outputs to `dist`. Run via `node dist/index.js` in production. Database migrations are handled via custom `npm run db:migrate` scripts that execute the raw SQL files against the Supabase instance.

---

## 6. Recent Enhancements & UI Polish (Update Log)

The following major improvements were recently implemented to elevate the application's responsiveness, security, and premium aesthetic:

### 6.1 Responsive UI & Layout Improvements
- **Admin Sidebar Redesign:** Upgraded to a premium aesthetic featuring a new search bar, elegant category headers (`NAVIGATION`, `SETTINGS`), and soft, pill-based active/hover states, moving away from rigid edge-to-edge highlights.
- **Communications Module Overhaul:** 
  - Restored the missing desktop CSS Grid layout, ensuring a perfect side-by-side view (Thread List + Message Pane) on large screens.
  - Wrapped the entire interface in a unified "surface card" with drop shadows, eliminating disjointed background colors.
  - Replaced plain text loading states with sophisticated, animated pulsing skeleton loaders (avatars and chat bubbles).
  - Redesigned all empty states ("No Thread Selected", "No messages") with high-quality Lucide icons resting in soft circular backgrounds.
- **Newsletter Table Responsiveness:** Completely refactored the rigid `<table>` structure into a fluid, flexbox-based list. This maintains a tabular layout on desktop while gracefully wrapping into clean, multi-line cards on mobile devices to prevent horizontal clipping.
- **Topbar & Typographics:** Fixed spacing, font sizes, and line-heights on role label pills to ensure perfectly balanced vertical text centering. Modernized the profile dropdown menu with pill-shaped hover effects and corrected label typos.

### 6.2 Security & RBAC Routing
- **Strict Module Access:** Updated the centralized `rolePermissions.ts` to strictly revoke `Overview` access from lower-level staff (Logistics, Finance, Support, CRM), limiting it exclusively to Super Admins and Managers.
- **Intelligent Login Redirection:** Modified the login flow to intelligently detect a user's role upon authentication and instantly redirect them to their respective operational dashboard (e.g., Logistics Officers land on `/admin/shipments`), bypassing the restricted Overview page.
- **Route-Level Interception:** Upgraded the React Router (`AdminRoute` wrapper) to actively intercept direct URL manipulation. Unauthorized attempts to access `/admin` or `/admin/reports` automatically validate against `hasModuleAccess` and bounce the user to their authorized module.

### 6.3 Code Quality
- Resolved stale TypeScript errors relating to unused state hooks during the responsive refactoring phase.
- Validated application stability with a clean, zero-error production build (`npm run build`).
- Safely committed and pushed all architectural and UI changes to the remote repository.
