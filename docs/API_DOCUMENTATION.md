# VHI CRM & Client Portal API Documentation

This document provides complete specification for all REST API endpoints across Authentication, Admin Management, Client Portal, Shipments, Tracking, Invoices, Payments, Communications, Newsletter, Reports, Feedback, and Global Search modules.

---

## Base URLs
- **Admin API**: `http://localhost:5000/api/admin`
- **Client API**: `http://localhost:5000/api/client`
- **Public API**: `http://localhost:5000/api`

## Authentication & Authorization Header
All authenticated requests must include the JWT Bearer Token:
```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```

### Supported Roles (`AdminRole`)
- `super_admin` - Full access (`*`)
- `manager` - Access to Overview, Customers, Shipments, Tracking, Invoices, Communications, Newsletter, Reports, Settings
- `logistics_officer` - Access to Shipments, Tracking, Communications
- `finance_officer` - Access to Customers, Shipments, Invoices, Payments, Reports
- `crm_officer` - Access to Customers, Newsletter, Audience Segmentation, Communications
- `support_staff` - Read-only access to Customers, Shipments, Communications, Reports

---

## 1. Admin Authentication (`/api/admin`)

### 1.1 Verify Admin Email (Step 1 of Login)
- **Endpoint**: `POST /api/admin/verify-email`
- **Access**: Public
- **Request Body**:
```json
{
  "email": "admin@vhi.com"
}
```
- **Response** `(200 OK)`:
```json
{
  "success": true,
  "message": "Email verified"
}
```

### 1.2 Admin Login (Step 2 of Login)
- **Endpoint**: `POST /api/admin/login`
- **Access**: Public
- **Request Body**:
```json
{
  "email": "admin@vhi.com",
  "password": "yourpassword"
}
```
- **Response** `(200 OK)`:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOi...",
    "admin": {
      "id": "uuid",
      "name": "Admin Name",
      "email": "admin@vhi.com",
      "activeRole": "super_admin",
      "assignedRoles": ["super_admin", "finance_officer"],
      "notificationPrefs": {}
    }
  }
}
```

### 1.3 Switch Active Role
- **Endpoint**: `POST /api/admin/switch-role`
- **Access**: Bearer Token Required
- **Request Body**:
```json
{
  "role": "finance_officer"
}
```
- **Response** `(200 OK)`:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOi...",
    "admin": {
      "id": "uuid",
      "name": "Admin Name",
      "email": "admin@vhi.com",
      "activeRole": "finance_officer",
      "assignedRoles": ["super_admin", "finance_officer"],
      "notificationPrefs": {}
    }
  }
}
```

### 1.4 Get Current Admin Session (`/me`)
- **Endpoint**: `GET /api/admin/me`
- **Access**: Bearer Token Required
- **Response** `(200 OK)`:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Admin Name",
    "email": "admin@vhi.com",
    "activeRole": "super_admin",
    "assignedRoles": ["super_admin", "finance_officer"],
    "notificationPrefs": {}
  }
}
```

### 1.5 Update Admin Profile
- **Endpoint**: `PUT /api/admin/profile`
- **Access**: Bearer Token Required
- **Request Body**: `{ "name": "New Name", "phone": "+234..." }`

### 1.6 Change Password
- **Endpoint**: `PUT /api/admin/change-password`
- **Access**: Bearer Token Required
- **Request Body**: `{ "currentPassword": "old", "newPassword": "new" }`

### 1.7 Logout
- **Endpoint**: `POST /api/admin/logout`
- **Access**: Bearer Token Required

---

## 2. Client Portal Authentication (`/api/client/auth`)

### 2.1 Client Registration
- **Endpoint**: `POST /api/client/auth/register`
- **Access**: Public
- **Request Body**:
```json
{
  "firstname": "John",
  "lastname": "Doe",
  "email": "client@gmail.com",
  "phone": "+2348012345678",
  "password": "Password123"
}
```

### 2.2 Client Login
- **Endpoint**: `POST /api/client/auth/login`
- **Access**: Public
- **Request Body**: `{ "email": "client@gmail.com", "password": "Password123" }`
- **Response**: `{ "success": true, "data": { "token": "...", "client": { ... } } }`

---

## 3. Shipments (`/api/admin/shipments` & `/api/client/shipments`)

### 3.1 List Admin Shipments
- **Endpoint**: `GET /api/admin/shipments`
- **Query Parameters**: `?search=&status=&shippingMode=&page=1&limit=20`
- **Response**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "orderId": "#1895-67-fw",
        "status": "in_transit",
        "shippingMode": "air_freight",
        "originAddress": "Lagos, Nigeria",
        "destinationAddress": "London, UK",
        "weight": 24,
        "invoiceValue": 150000
      }
    ],
    "total": 45,
    "page": 1,
    "totalPages": 3
  }
}
```

### 3.2 Get Shipment Details
- **Endpoint**: `GET /api/admin/shipments/:id`

### 3.3 Create Shipment
- **Endpoint**: `POST /api/admin/shipments`
- **Request Body**:
```json
{
  "customerId": "uuid",
  "shippingMode": "air_freight",
  "deliveryMode": "door_to_door",
  "originAddress": "Lagos",
  "destinationAddress": "London",
  "natureOfItem": "Electronics",
  "items": [
    { "description": "Laptops", "quantity": 5, "weight": 10 }
  ]
}
```

### 3.4 Update Shipment Status
- **Endpoint**: `PUT /api/admin/shipments/:id/status`
- **Request Body**: `{ "status": "in_transit", "message": "Cleared customs" }`

---

## 4. Tracking (`/api/admin/shipments/:id/tracking` & `/api/tracking`)

### 4.1 Update Tracking Information (AWB / BOL / Unique ID)
- **Endpoint**: `PUT /api/admin/shipments/:id/tracking`
- **Access**: Admin Token Required
- **Request Body**:
```json
{
  "awbNumber": "AWB99283",
  "bolNumber": "BOL11233",
  "uniqueId": "CON8823"
}
```

### 4.2 Public Tracking Lookup
- **Endpoint**: `GET /api/tracking/:trackingNumber`
- **Access**: Public
- **Response**:
```json
{
  "success": true,
  "data": {
    "orderId": "#1895-67-fw",
    "status": "in_transit",
    "trackingUpdates": [
      { "status": "in_transit", "message": "In flight to Heathrow", "createdAt": "2026-08-28" }
    ]
  }
}
```

---

## 5. Invoices & Payments (`/api/admin/invoices` & `/api/admin/payments`)

### 5.1 List Invoices
- **Endpoint**: `GET /api/admin/invoices`
- **Query Parameters**: `?status=&customerId=&page=1`

### 5.2 Create Invoice
- **Endpoint**: `POST /api/admin/invoices`
- **Request Body**:
```json
{
  "shipmentId": "uuid",
  "customerId": "uuid",
  "amount": 250000,
  "currency": "NGN",
  "dueDate": "2026-09-15"
}
```

### 5.3 Record Payment
- **Endpoint**: `POST /api/admin/invoices/:id/payments`
- **Request Body**: `{ "amount": 100000, "paymentMethod": "paystack", "notes": "Part payment" }`

---

## 6. Communications (`/api/admin/communications`)

### 6.1 List Communication Threads
- **Endpoint**: `GET /api/admin/communications`

### 6.2 Get Thread Messages
- **Endpoint**: `GET /api/admin/communications/thread/:customerId`

### 6.3 Send Message to Customer
- **Endpoint**: `POST /api/admin/communications/send`
- **Request Body**:
```json
{
  "customerId": "uuid",
  "subject": "Shipment Update",
  "body": "Your shipment has arrived at the destination warehouse."
}
```

---

## 7. Newsletter (`/api/admin/newsletter`)

### 7.1 List Subscribers
- **Endpoint**: `GET /api/admin/newsletter/subscribers`

### 7.2 Get Real-time Audience Filter Count
- **Endpoint**: `POST /api/admin/newsletter/preview-count`
- **Request Body**: `{ "segment": "medical_pharma", "industry": "medical" }`
- **Response**: `{ "success": true, "count": 14 }`

### 7.3 Broadcast Newsletter
- **Endpoint**: `POST /api/admin/newsletter/send`
- **Request Body**: `{ "segment": "all", "subject": "August Promotion", "body": "Special discounts on air freight!" }`

---

## 8. Admin Management (`/api/admin/management`)

### 8.1 List All Admin Accounts
- **Endpoint**: `GET /api/admin/management`
- **Access**: Super Admin Only

### 8.2 Invite Admin User
- **Endpoint**: `POST /api/admin/management/invite`
- **Access**: Super Admin Only
- **Request Body**:
```json
{
  "name": "New Officer",
  "email": "officer@vhi.com",
  "assignedRoles": ["logistics_officer", "finance_officer"]
}
```

### 8.3 Update Admin Assigned Roles
- **Endpoint**: `PUT /api/admin/management/:id/roles`
- **Access**: Super Admin Only
- **Request Body**:
```json
{
  "assignedRoles": ["manager", "super_admin"]
}
```

### 8.4 Toggle Admin Active Status
- **Endpoint**: `PUT /api/admin/management/:id/status`
- **Request Body**: `{ "isActive": false }`

### 8.5 Reset Admin Password
- **Endpoint**: `POST /api/admin/management/:id/reset-password`
- **Request Body**: `{ "newPassword": "OptionalNewPassword123" }`
