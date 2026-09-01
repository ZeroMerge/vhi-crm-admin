# VHI CRM & Client Portal API Specification

> **Version:** 1.0.0  
> **Protocol:** REST over HTTPS  
> **Data Format:** JSON (`application/json`)  
> **Base URLs:**
> - Admin API: `http://localhost:5000/api/admin`
> - Client API: `http://localhost:5000/api/client`
> - Public API: `http://localhost:5000/api`

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Global Conventions & Response Formats](#2-global-conventions--response-formats)
3. [Admin Authentication (`/auth`)](#3-admin-authentication-auth)
4. [Admin User Management (`/management`)](#4-admin-user-management-management)
5. [Client Authentication (`/client/auth`)](#5-client-authentication-clientauth)
6. [Client Shipments & Tracking (`/client`)](#6-client-shipments--tracking-client)
7. [Shipments Module (`/shipments`)](#7-shipments-module-shipments)
8. [Tracking Module (`/tracking`)](#8-tracking-module-tracking)
9. [Customers Module (`/customers`)](#9-customers-module-customers)
10. [Invoices Module (`/invoices`)](#10-invoices-module-invoices)
11. [Payments Module (`/payments`)](#11-payments-module-payments)
12. [Communications Module (`/communications`)](#12-communications-module-communications)
13. [Newsletter Module (`/newsletter`)](#13-newsletter-module-newsletter)
14. [Reports & Analytics (`/reports`)](#14-reports--analytics-reports)
15. [Global Search & Feedback (`/search`, `/feedback`)](#15-global-search--feedback-search-feedback)

---

## 1. Authentication & Authorization

### 1.1 Bearer Token Header
All protected endpoints require a valid JSON Web Token (JWT) supplied in the `Authorization` header:
```http
Authorization: Bearer <jwt_token>
```

### 1.2 Admin Roles & Permissions
The backend enforces role-based access control (RBAC). Admin JWT payloads contain `activeRole` and `assignedRoles`.

| Role Identifier | Description | Default Access Scope |
|---|---|---|
| `super_admin` | Full system administrator | Unrestricted (`*`) |
| `manager` | Operational team lead | Overview, Shipments, Customers, Invoices, Communications, Newsletter, Reports, Settings |
| `logistics_officer` | Freight & tracking coordinator | Shipments, Tracking, Communications |
| `finance_officer` | Billing & revenue accountant | Customers, Shipments, Invoices, Payments, Reports |
| `crm_officer` | Customer engagement specialist | Customers, Newsletter, Communications |
| `support_staff` | Customer support agent | Read-only access to Customers, Shipments, Communications |

---

## 2. Global Conventions & Response Formats

### 2.1 Standard Success Envelope
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional human-readable confirmation string"
}
```

### 2.2 Standard Paginated Envelope
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 120,
    "page": 1,
    "pageSize": 10,
    "totalPages": 12
  }
}
```

### 2.3 Standard Error Envelope
```json
{
  "success": false,
  "message": "Detailed description of the error",
  "errors": { ... }
}
```

### 2.4 Common HTTP Status Codes
- `200 OK` – Request succeeded; response payload returned.
- `201 Created` – Resource created successfully.
- `400 Bad Request` – Missing or invalid request parameters/body.
- `401 Unauthorized` – Missing, invalid, or expired JWT.
- `403 Forbidden` – Insufficient role permissions or unverified account.
- `404 Not Found` – Target resource does not exist.
- `409 Conflict` – Resource already exists (e.g. duplicate email).
- `500 Internal Server Error` – Unhandled server exception.

---

## 3. Admin Authentication (`/auth`)

Base Path: `/api/admin`

### 3.1 Verify Admin Email (Step 1 of 2-Step Login)
Validates that an email belongs to an active administrator with assigned roles.

- **Method:** `POST`
- **Path:** `/api/admin/verify-email`
- **Auth:** None (Public)
- **Request Body:**
```json
{
  "email": "admin@vhi.com"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Email verified"
}
```
- **Errors:** `400 Bad Request` (Missing email), `404 Not Found` (Email not found), `403 Forbidden` (No assigned roles attached).

---

### 3.2 Admin Login (Step 2 of 2-Step Login)
Authenticates credentials, updates `last_login_at`, and returns a signed JWT.

- **Method:** `POST`
- **Path:** `/api/admin/login`
- **Auth:** None (Public)
- **Request Body:**
```json
{
  "email": "admin@vhi.com",
  "password": "SecurePassword123!"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "admin": {
      "id": "7b8e1f0e-3c2b-4e1a-9f5a-8b1e0f3c2b4e",
      "name": "Alex Johnson",
      "email": "admin@vhi.com",
      "activeRole": "super_admin",
      "assignedRoles": ["super_admin", "manager"],
      "notificationPrefs": {
        "emailAlerts": true,
        "shipmentUpdates": true
      }
    }
  }
}
```
- **Errors:** `400 Bad Request`, `401 Unauthorized` (Invalid password/email), `403 Forbidden` (Role unassigned).

---

### 3.3 Switch Active Role
Allows multi-role administrators to switch active context and issues a refreshed JWT.

- **Method:** `POST`
- **Path:** `/api/admin/switch-role`
- **Auth:** Required (`adminMiddleware`)
- **Request Body:**
```json
{
  "role": "finance_officer"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "admin": {
      "id": "7b8e1f0e-3c2b-4e1a-9f5a-8b1e0f3c2b4e",
      "name": "Alex Johnson",
      "email": "admin@vhi.com",
      "activeRole": "finance_officer",
      "assignedRoles": ["super_admin", "finance_officer"],
      "notificationPrefs": {}
    }
  }
}
```
- **Errors:** `400 Bad Request`, `403 Forbidden` (Target role not in admin's `assignedRoles`).

---

### 3.4 Get Current Admin Profile (`/me`)
- **Method:** `GET`
- **Path:** `/api/admin/me`
- **Auth:** Required
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "id": "7b8e1f0e-3c2b-4e1a-9f5a-8b1e0f3c2b4e",
    "name": "Alex Johnson",
    "email": "admin@vhi.com",
    "activeRole": "super_admin",
    "assignedRoles": ["super_admin", "finance_officer"],
    "notificationPrefs": {}
  }
}
```

---

### 3.5 Change Password
- **Method:** `PUT`
- **Path:** `/api/admin/change-password`
- **Auth:** Required
- **Request Body:**
```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewSecurePassword456!"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Password updated"
}
```

---

### 3.6 Update Profile
- **Method:** `PUT`
- **Path:** `/api/admin/profile`
- **Auth:** Required
- **Request Body:**
```json
{
  "name": "Alex Johnson",
  "phone": "+2348012345678"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Profile updated successfully"
}
```

---

### 3.7 Update Notification Preferences
- **Method:** `PUT`
- **Path:** `/api/admin/notification-preferences`
- **Auth:** Required
- **Request Body:**
```json
{
  "notificationPrefs": {
    "emailAlerts": true,
    "smsAlerts": false,
    "shipmentStatusChange": true
  }
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Notification preferences updated successfully"
}
```

---

### 3.8 Admin Logout
- **Method:** `POST`
- **Path:** `/api/admin/logout`
- **Auth:** Required
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Logged out"
}
```

---

## 4. Admin User Management (`/management`)

Base Path: `/api/admin/management`  
**Access Scope:** Super Admin Only (`requireActiveRole('super_admin')`)

### 4.1 List All Admin Accounts
- **Method:** `GET`
- **Path:** `/api/admin/management`
- **Auth:** Required (`super_admin`)
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "7b8e1f0e-3c2b-4e1a-9f5a-8b1e0f3c2b4e",
      "name": "Sarah Connor",
      "email": "sarah@vhi.com",
      "assigned_roles": ["manager", "logistics_officer"],
      "is_active": true,
      "created_at": "2026-07-15T08:30:00.000Z",
      "last_login_at": "2026-08-28T14:20:00.000Z"
    }
  ]
}
```

---

### 4.2 Invite Admin User
Creates an admin record, generates a temporary password and invite link.

- **Method:** `POST`
- **Path:** `/api/admin/management/invite`
- **Auth:** Required (`super_admin`)
- **Request Body:**
```json
{
  "name": "David Miller",
  "email": "david.miller@vhi.com",
  "assignedRoles": ["logistics_officer", "support_staff"]
}
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "message": "Admin invited successfully. An email invitation has been sent.",
  "data": {
    "admin": {
      "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "David Miller",
      "email": "david.miller@vhi.com",
      "assigned_roles": ["logistics_officer", "support_staff"],
      "is_active": true,
      "created_at": "2026-09-01T10:00:00.000Z"
    },
    "inviteLink": "http://localhost:3000/admin/setup-password?token=1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "tempPassword": "abc123xyzA@1"
  }
}
```

---

### 4.3 Update Admin Assigned Roles
- **Method:** `PUT`
- **Path:** `/api/admin/management/:id/roles`
- **Auth:** Required (`super_admin`)
- **Request Body:**
```json
{
  "assignedRoles": ["super_admin", "manager"]
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "name": "David Miller",
    "email": "david.miller@vhi.com",
    "assigned_roles": ["super_admin", "manager"],
    "is_active": true
  }
}
```

---

### 4.4 Toggle Admin Active Status
- **Method:** `PUT`
- **Path:** `/api/admin/management/:id/status`
- **Auth:** Required (`super_admin`)
- **Request Body:**
```json
{
  "isActive": false
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "is_active": false
  }
}
```

---

### 4.5 Reset Admin Password
- **Method:** `POST`
- **Path:** `/api/admin/management/:id/reset-password`
- **Auth:** Required (`super_admin`)
- **Request Body (Optional):**
```json
{
  "newPassword": "OptionalNewPassword123!"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Password reset successfully.",
  "data": {
    "tempPassword": "generatedPasswordA@1"
  }
}
```

---

### 4.6 Soft Delete Admin Account
- **Method:** `DELETE`
- **Path:** `/api/admin/management/:id`
- **Auth:** Required (`super_admin`)
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Admin deleted successfully"
}
```

---

## 5. Client Authentication (`/client/auth`)

Base Path: `/api/client/auth`

### 5.1 Client Registration
- **Method:** `POST`
- **Path:** `/api/client/auth/register`
- **Auth:** None (Public)
- **Request Body:**
```json
{
  "firstname": "Samuel",
  "lastname": "Okafor",
  "email": "samuel.okafor@example.com",
  "password": "ClientPassword123!",
  "phone": "+2348039876543",
  "industry": "medical_pharma"
}
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email to verify your account.",
  "data": {
    "id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
    "userId": "VHI-4F8A9B2C",
    "firstname": "Samuel",
    "lastname": "Okafor",
    "email": "samuel.okafor@example.com"
  }
}
```

---

### 5.2 Verify Client Email
- **Method:** `GET`
- **Path:** `/api/client/auth/verify-email?token=<verification_token>`
- **Auth:** None (Public)
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Email verified successfully. You can now log in."
}
```

---

### 5.3 Client Login
- **Method:** `POST`
- **Path:** `/api/client/auth/login`
- **Auth:** None (Public)
- **Request Body:**
```json
{
  "email": "samuel.okafor@example.com",
  "password": "ClientPassword123!"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "customer": {
      "id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
      "userId": "VHI-4F8A9B2C",
      "firstname": "Samuel",
      "lastname": "Okafor",
      "email": "samuel.okafor@example.com",
      "industry": "medical_pharma",
      "status": "lead"
    }
  }
}
```

---

## 6. Client Shipments & Tracking (`/client`)

Base Path: `/api/client`  
**Auth:** Required Client JWT (`customerMiddleware`)

### 6.1 Get Client Shipments
- **Method:** `GET`
- **Path:** `/api/client/shipments`
- **Query Parameters:**
  - `page` *(number, default: 1)*
  - `pageSize` *(number, default: 10)*
- **Response `200 OK`:** Returns paginated list of shipments owned by the authenticated client.

---

### 6.2 Book New Shipment (Client Portal)
Submits booking data and handles multipart file uploads (up to 4 documents: invoices, packing lists).

- **Method:** `POST`
- **Path:** `/api/client/shipments`
- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `shippingMode` *(string, required: `air_freight` \| `sea_freight` \| `groupage` \| `consolidation` \| `china_groupage` \| `cargo_clearing` \| `export`)*
  - `deliveryMode` *(string, required: e.g. `door_to_door` \| `port_to_port`)*
  - `natureOfItem` *(string, required: e.g. `Medical Diagnostic Equipment`)*
  - `originAddress` *(string, required)*
  - `destinationAddress` *(string, required)*
  - `originEmail` *(string, optional)*
  - `originPhone` *(string, optional)*
  - `destinationEmail` *(string, optional)*
  - `destinationPhone` *(string, optional)*
  - `countryOfOrigin` *(string, optional)*
  - `exWorkType` *(string, optional)*
  - `invoiceValue` *(number, default: 0)*
  - `invoiceCurrency` *(string, default: `NGN`)*
  - `items` *(JSON stringified array of items)*:
    ```json
    [
      {
        "description": "ECG Machines",
        "category": "Medical Devices",
        "quantity": 2,
        "weight": 18.5,
        "dimensionL": 50,
        "dimensionW": 40,
        "dimensionH": 30,
        "dimensionUnit": "cm"
      }
    ]
    ```
  - `documents` *(files, optional, max 4 attachments)*
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "id": "3b2a1c0d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "order_id": "VHI-AIR-98234",
    "customer_id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
    "shipping_mode": "air_freight",
    "delivery_mode": "door_to_door",
    "nature_of_item": "Medical Diagnostic Equipment",
    "status": "pending",
    "is_draft": false,
    "created_at": "2026-09-01T10:15:00.000Z"
  }
}
```

---

### 6.3 Get Client Shipment Tracking Timeline
- **Method:** `GET`
- **Path:** `/api/client/tracking/:orderId`
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "orderId": "VHI-AIR-98234",
    "status": "in_transit",
    "createdAt": "2026-09-01T10:15:00.000Z",
    "shippingMode": "air_freight",
    "deliveryMode": "door_to_door",
    "natureOfItem": "Medical Diagnostic Equipment",
    "originAddress": "Shanghai Warehouse, China",
    "destinationAddress": "Victoria Island, Lagos, Nigeria",
    "totalWeight": 37,
    "weightUnit": "kg",
    "trackingUpdates": [
      {
        "status": "pending",
        "message": "Shipment order booked and confirmed",
        "createdAt": "2026-09-01T10:15:00.000Z"
      },
      {
        "status": "in_transit",
        "message": "Cargo departed Shanghai Pudong (PVG) on flight ET374",
        "createdAt": "2026-09-01T14:30:00.000Z"
      }
    ]
  }
}
```

---

## 7. Shipments Module (`/shipments`)

Base Path: `/api/admin/shipments`  
**Auth:** Required Admin JWT

### 7.1 List Admin Shipments
- **Method:** `GET`
- **Path:** `/api/admin/shipments`
- **Query Parameters:**

| Parameter | Type | Required | Default | Allowed Values / Description |
|---|---|---|---|---|
| `search` | string | No | `""` | Search in order ID, nature of item, AWB, BOL, customer name |
| `status` | string | No | `"all"` | `all`, `pending`, `confirmed`, `in_transit`, `customs_clearing`, `delivered`, `cancelled` |
| `mode` | string | No | `"all"` | `all`, `air_freight`, `sea_freight`, `groupage`, `consolidation`, `china_groupage`, `cargo_clearing`, `export` |
| `customerId` | string | No | - | Filter by customer UUID |
| `dateFrom` | string | No | - | ISO date format (e.g. `2026-08-01`) |
| `dateTo` | string | No | - | ISO date format (e.g. `2026-08-31`) |
| `sortBy` | string | No | `"newest"` | `newest`, `oldest`, `price-high-low` (`price_desc`), `price-low-high` (`price_asc`) |
| `page` | number | No | `1` | Page number |
| `pageSize` | number | No | `10` | Records per page |

- **Response `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "3b2a1c0d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "order_id": "VHI-AIR-98234",
      "customer_id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
      "shipping_mode": "air_freight",
      "delivery_mode": "door_to_door",
      "nature_of_item": "Medical Diagnostic Equipment",
      "hs_code": "9018.19",
      "invoice_value": 4500000,
      "invoice_currency": "NGN",
      "weight": 37,
      "weight_unit": "kg",
      "origin_address": "Shanghai, China",
      "destination_address": "Lagos, Nigeria",
      "origin_pickup_option": "warehouse",
      "port_of_discharge": "LOS",
      "awb_number": "083-99882211",
      "bol_number": null,
      "unique_id": "CON-98234",
      "status": "in_transit",
      "is_draft": false,
      "firstname": "Samuel",
      "lastname": "Okafor",
      "email": "samuel.okafor@example.com",
      "phone": "+2348039876543",
      "industry": "medical_pharma",
      "created_at": "2026-09-01T10:15:00.000Z"
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "pageSize": 10,
    "totalPages": 5
  }
}
```

---

### 7.2 Get Shipment Details
- **Method:** `GET`
- **Path:** `/api/admin/shipments/:id`
- **Response `200 OK`:** Returns complete shipment object including `items` array, `documents` array, and chronological `trackingUpdates` array.

---

### 7.3 Create Shipment (Admin)
- **Method:** `POST`
- **Path:** `/api/admin/shipments`
- **Request Body:**
```json
{
  "customerId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
  "shippingMode": "air_freight",
  "deliveryMode": "door_to_door",
  "natureOfItem": "Industrial Machine Parts",
  "hsCode": "8479.89",
  "invoiceValue": 8200000,
  "invoiceCurrency": "NGN",
  "weight": 140,
  "weightUnit": "kg",
  "originAddress": "Frankfurt Cargo City South, Germany",
  "destinationAddress": "Ikeja Industrial Estate, Lagos",
  "originPickupOption": "factory",
  "port_of_discharge": "Murtala Muhammed International Airport (LOS)",
  "awbNumber": "020-88776655",
  "bolNumber": null,
  "uniqueId": "VHI-GER-001",
  "status": "pending",
  "isDraft": false
}
```
- **Response `201 Created`:** Returns created shipment record with generated `order_id`.

---

### 7.4 Update Shipment Status
- **Method:** `PUT`
- **Path:** `/api/admin/shipments/:id/status`
- **Request Body:**
```json
{
  "status": "customs_clearing",
  "message": "Documents submitted to NAHCO Customs Clearing Unit"
}
```
- **Response `200 OK`:** `{ "success": true, "data": { ...updatedShipment } }`

---

### 7.5 Update Shipment Tracking Identifiers
- **Method:** `PUT`
- **Path:** `/api/admin/shipments/:id/tracking`
- **Request Body:**
```json
{
  "awbNumber": "083-99882211",
  "bolNumber": "MEDU98765432",
  "uniqueId": "CON-98234"
}
```
- **Response `200 OK`:** `{ "success": true, "data": { ...updatedShipment } }`

---

### 7.6 Upload Shipment Document
- **Method:** `POST`
- **Path:** `/api/admin/shipments/:id/documents`
- **Request Body:**
```json
{
  "fileUrl": "https://res.cloudinary.com/vhi/image/upload/v1234/bill_of_lading.pdf",
  "cloudinaryPublicId": "vhi/bill_of_lading",
  "uploadedBy": "admin"
}
```
- **Response `200 OK`:** `{ "success": true, "data": { ...documentRecord } }`

---

### 7.7 Delete Shipment Document
- **Method:** `DELETE`
- **Path:** `/api/admin/shipments/:id/documents/:docId`
- **Response `200 OK`:** `{ "success": true, "message": "Document deleted" }`

---

## 8. Tracking Module (`/tracking`)

Base Path: `/api/admin/tracking` (Admin) & `/api/tracking` (Public)

### 8.1 List Active Shipments for Tracking
- **Method:** `GET`
- **Path:** `/api/admin/tracking`
- **Query Parameters:**
  - `search` *(string)*: Search order ID, AWB, BOL, or Unique ID.
  - `filter` *(string)*: `missing` (no tracking numbers), `has_awb`, `has_bol`, `has_unique`.
  - `mode` *(string)*: `air_freight`, `sea` (`groupage`, `consolidation`, `china_groupage`).
- **Response `200 OK`:** Array of active tracking records.

---

### 8.2 List Shipments Pending Tracking Numbers
- **Method:** `GET`
- **Path:** `/api/admin/tracking/pending`
- **Response `200 OK`:** Array of shipments without AWB/BOL/Unique ID assigned.

---

### 8.3 Append Tracking Timeline Event
- **Method:** `POST`
- **Path:** `/api/admin/tracking/:shipmentId/update`
- **Request Body:**
```json
{
  "status": "in_transit",
  "message": "Customs clearance completed; dispatched to regional hub."
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "id": "5c4b3a2d-1e0f-9a8b-7c6d-5e4f3a2b1c0d",
    "shipment_id": "3b2a1c0d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "status": "in_transit",
    "message": "Customs clearance completed; dispatched to regional hub.",
    "updated_by": "7b8e1f0e-3c2b-4e1a-9f5a-8b1e0f3c2b4e",
    "created_at": "2026-09-01T15:00:00.000Z"
  }
}
```

---

### 8.4 Public Tracking Lookup (No Auth Required)
- **Method:** `GET`
- **Path:** `/api/tracking/:trackingId`
- **Parameters:** `:trackingId` matching `awb_number`, `bol_number`, or `unique_id`.
- **Response `200 OK`:** Returns shipment details and public tracking updates timeline.

---

## 9. Customers Module (`/customers`)

Base Path: `/api/admin/customers`  
**Auth:** Required Admin JWT

### 9.1 List Customers
- **Method:** `GET`
- **Path:** `/api/admin/customers`
- **Query Parameters:**

| Parameter | Type | Default | Allowed Values / Description |
|---|---|---|---|
| `search` | string | `""` | Match in firstname, lastname, email, or user_id |
| `industry` | string | `"all"` | `all`, `medical_pharma`, `automotive`, `oil_gas`, `general`, `technology` |
| `star` | number | `"all"` | `1`, `2`, `3`, `4`, `5` |
| `status` | string | `"all"` | `all`, `lead`, `prospect`, `active`, `dormant`, `churned` |
| `sortBy` | string | `"newest"` | `newest`, `oldest`, `name-a-z`, `name-z-a`, `star-high-low` |
| `page` | number | `1` | Page index |
| `pageSize` | number | `10` | Page size |

- **Response `200 OK`:** Paginated customer list.

---

### 9.2 Create Customer
- **Method:** `POST`
- **Path:** `/api/admin/customers`
- **Request Body:**
```json
{
  "firstname": "Grace",
  "lastname": "Eze",
  "email": "grace.eze@medpharma.ng",
  "phone": "+2348023456789",
  "industry": "medical_pharma",
  "status": "lead"
}
```
- **Response `201 Created`:** Returns created customer record with generated `userId` (`CUST-0042`).

---

### 9.3 Update Customer Details
- **Method:** `PUT`
- **Path:** `/api/admin/customers/:id`
- **Request Body:** `{ "firstname": "...", "lastname": "...", "email": "...", "phone": "...", "industry": "...", "status": "..." }`

---

### 9.4 Update Customer Star Rating
- **Method:** `PUT`
- **Path:** `/api/admin/customers/:id/star`
- **Request Body:** `{ "starRating": 5 }`

---

### 9.5 Update Customer Lifecycle Status
- **Method:** `PUT`
- **Path:** `/api/admin/customers/:id/status`
- **Request Body:** `{ "status": "active" }`

---

### 9.6 Update Customer Industry Segment
- **Method:** `PUT`
- **Path:** `/api/admin/customers/:id/segment`
- **Request Body:** `{ "industry": "technology" }`

---

### 9.7 Delete Customer
- **Method:** `DELETE`
- **Path:** `/api/admin/customers/:id`

---

### 9.8 Get Customer Shipments History
- **Method:** `GET`
- **Path:** `/api/admin/customers/:id/shipments`

---

### 9.9 Get Customer Payments History
- **Method:** `GET`
- **Path:** `/api/admin/customers/:id/payments`

---

## 10. Invoices Module (`/invoices`)

Base Path: `/api/admin/invoices`  
**Auth:** Required Admin JWT

### 10.1 List Invoices
- **Method:** `GET`
- **Path:** `/api/admin/invoices`
- **Query Parameters:**
  - `status` *(string)*: `all`, `draft`, `unpaid`, `partially_paid`, `paid`, `overdue`, `cancelled`
  - `currency` *(string)*: `all`, `NGN`, `USD`, `GBP`, `EUR`, `RMB`
  - `customerId` *(string)*: Customer UUID
  - `search` *(string)*: Search invoice number or customer name
  - `dateFrom` / `dateTo` *(string)*: ISO date boundaries
  - `overdue` *(boolean)*: `true` to filter overdue unpaid invoices
  - `sortBy` *(string)*: `newest`, `oldest`, `amount-high-low`, `amount-low-high`
  - `page` / `pageSize` *(number)*
- **Response `200 OK`:** Paginated invoices list with attached customer and shipment metadata.

---

### 10.2 Create Invoice
- **Method:** `POST`
- **Path:** `/api/admin/invoices`
- **Request Body:**
```json
{
  "shipmentId": "3b2a1c0d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
  "customerId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
  "amount": 1250000.00,
  "currency": "NGN",
  "dueDate": "2026-09-20",
  "notes": "Freight handling, customs clearance & door delivery fee."
}
```
- **Response `201 Created`:** Returns created invoice with generated `invoiceNumber` (e.g. `INV-2026-0089`).

---

### 10.3 Update Invoice Status
- **Method:** `PUT`
- **Path:** `/api/admin/invoices/:id/status`
- **Request Body:** `{ "status": "paid" }`

---

### 10.4 Send Invoice Reminder
- **Method:** `PUT`
- **Path:** `/api/admin/invoices/:id/reminder`
- **Request Body:** `{ "followUpDate": "2026-09-18" }`

---

### 10.5 Record Payment on Invoice
- **Method:** `PUT`
- **Path:** `/api/admin/invoices/:id/payment`
- **Request Body:**
```json
{
  "amount": 1250000.00,
  "paymentMethod": "paystack",
  "status": "paid"
}
```

---

## 11. Payments Module (`/payments`)

Base Path: `/api/admin/payments`  
**Auth:** Required Admin JWT (for listing) / Public (for Gateways & Webhooks)

### 11.1 List Recorded Transactions
- **Method:** `GET`
- **Path:** `/api/admin/payments`
- **Query Parameters:** `status`, `page`, `pageSize`

---

### 11.2 Paystack Gateway Integration
- **Initialize Payment:** `POST /api/admin/payments/paystack/initialize`
  - Body: `{ "invoiceId": "...", "email": "...", "amount": 50000, "currency": "NGN" }`
  - Response: `{ "authorization_url": "https://paystack.com/pay/...", "reference": "PSK-..." }`
- **Verify Transaction:** `POST /api/admin/payments/paystack/verify`
  - Body: `{ "reference": "PSK-..." }`
- **Webhook Listener:** `POST /api/admin/payments/paystack/webhook`

---

### 11.3 Stripe Gateway Integration
- **Create Payment Intent:** `POST /api/admin/payments/stripe/intent`
  - Body: `{ "invoiceId": "...", "amount": 2500, "currency": "USD" }`
  - Response: `{ "clientSecret": "pi_..._secret_..." }`
- **Confirm Payment:** `POST /api/admin/payments/stripe/confirm`
  - Body: `{ "paymentIntentId": "pi_..." }`
- **Webhook Listener:** `POST /api/admin/payments/stripe/webhook`

---

## 12. Communications Module (`/communications`)

Base Path: `/api/admin/communications`  
**Auth:** Required Admin JWT

### 12.1 List Conversation Threads
- **Method:** `GET`
- **Path:** `/api/admin/communications`
- **Query Parameters:** `search`, `filter` (`unread`), `industry`, `sortBy` (`oldest`)
- **Response `200 OK`:** Returns threads grouped by customer with `unread_count`, `last_message`, and `last_message_at`.

---

### 12.2 Get Customer Thread Messages
- **Method:** `GET`
- **Path:** `/api/admin/communications/:customerId`
- **Side Effect:** Automatically marks retrieved unread messages as read (`is_read = true`).
- **Response `200 OK`:** Chronological message list for the customer.

---

### 12.3 Dispatch Message to Customer
- **Method:** `POST`
- **Path:** `/api/admin/communications/send`
- **Request Body:**
```json
{
  "customerId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
  "subject": "Shipment #VHI-AIR-98234 Departure Confirmation",
  "body": "Good day Samuel, your medical equipment has departed Shanghai and is en route to Lagos."
}
```
- **Response `200 OK`:** `{ "success": true, "data": { ...communicationRecord } }`

---

### 12.4 Delete Message
- **Method:** `DELETE`
- **Path:** `/api/admin/communications/:messageId`

---

## 13. Newsletter Module (`/newsletter`)

Base Path: `/api/admin/newsletter`  
**Auth:** Required Admin JWT

### 13.1 Get Segments Summary & Breakdown
- **Method:** `GET`
- **Path:** `/api/admin/newsletter/segments`
- **Response `200 OK`:** Array of segments with recipient counts and customer lists.

---

### 13.2 Move Customer Between Segments
- **Method:** `PUT`
- **Path:** `/api/admin/newsletter/segments/move`
- **Request Body:**
```json
{
  "customerId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
  "toIndustry": "oil_gas"
}
```

---

### 13.3 Calculate Broadcast Recipient Preview Count
Computes exact recipient reach before sending broadcast campaigns.

- **Method:** `POST`
- **Path:** `/api/admin/newsletter/preview-count`
- **Request Body:**
```json
{
  "segments": ["medical_pharma", "technology"],
  "status": "active"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "count": 28
}
```

---

### 13.4 Broadcast Newsletter Campaign
- **Method:** `POST`
- **Path:** `/api/admin/newsletter/send`
- **Request Body:**
```json
{
  "subject": "Q3 Special Cargo Rates: China to Nigeria Express Air",
  "body": "Dear Partner,\n\nWe are pleased to announce discounted groupage rates...",
  "segments": ["all"],
  "status": "all"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Newsletter sent to 142 recipients"
}
```

---

### 13.5 Broadcast Send History
- **Method:** `GET`
- **Path:** `/api/admin/newsletter/history`
- **Response `200 OK`:** List of past broadcast campaigns with timestamp and recipient totals.

---

## 14. Reports & Analytics (`/reports`)

Base Path: `/api/admin/reports`  
**Auth:** Required Admin JWT

### 14.1 Get Performance Metrics
- **Method:** `GET`
- **Path:** `/api/admin/reports/:period`
- **Parameters:** `:period` (`daily`, `weekly`, `monthly`)
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "newUsers": 12,
    "pendingShipments": 5,
    "totalEnquiries": 34,
    "revenue": 14500000.00,
    "shipmentBreakdown": [
      { "mode": "air_freight", "count": 18, "value": 9200000.00 },
      { "mode": "sea_freight", "count": 16, "value": 5300000.00 }
    ],
    "customerBreakdown": [
      { "status": "active", "count": 24 },
      { "status": "lead", "count": 10 }
    ]
  }
}
```

---

### 14.2 Export CSV Report
- **Method:** `GET`
- **Path:** `/api/admin/reports/export?period=monthly`
- **Response Header:** `Content-Type: text/csv`
- **Response Body:** CSV file download containing metrics summary.

---

## 15. Global Search & Feedback (`/search`, `/feedback`)

### 15.1 Global Omni-Search
Executes high-speed parallel search across Customers, Shipments, and Invoices.

- **Method:** `GET`
- **Path:** `/api/admin/search?q=Samuel`
- **Auth:** Required Admin JWT
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "customers": [
      {
        "id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
        "user_id": "VHI-4F8A9B2C",
        "firstname": "Samuel",
        "lastname": "Okafor",
        "email": "samuel.okafor@example.com",
        "industry": "medical_pharma",
        "status": "lead"
      }
    ],
    "shipments": [],
    "invoices": []
  }
}
```

---

### 15.2 List Customer Feedback
- **Method:** `GET`
- **Path:** `/api/admin/feedback`
- **Auth:** Required Admin JWT

---

### 15.3 Submit Customer Feedback
- **Method:** `POST`
- **Path:** `/api/admin/feedback`
- **Auth:** Required Admin JWT
- **Request Body:**
```json
{
  "customerId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
  "rating": 5,
  "message": "Exceptional customs clearance turnaround time on our air shipment."
}
```
- **Response `200 OK`:** `{ "success": true, "data": { ...feedbackRecord } }`
