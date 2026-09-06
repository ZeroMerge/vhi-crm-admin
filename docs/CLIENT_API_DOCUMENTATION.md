# VHI Client Portal API Documentation

This guide provides simple, direct instructions for frontend engineers building the **Client Portal / Customer-Facing Website**.

---

## 1. Quick Setup

- **Backend Base URL:** `http://localhost:5001` (Development)
- **Data Format:** JSON (`application/json`) except file uploads which use `multipart/form-data`
- **Auth Header:** Include on all protected customer requests:
  ```http
  Authorization: Bearer <customer_jwt_token>
  ```

### Standard Response Format
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

### Standard Error Format
```json
{
  "success": false,
  "message": "Human readable error reason"
}
```

---

## 2. Authentication API (`/api/client/auth`)

### 2.1 Register New Account
Creates a customer account and sends a 24-hour verification email.

- **Method:** `POST`
- **URL:** `/api/client/auth/register`
- **Auth:** Public (No token needed)

#### Request Body
```json
{
  "firstname": "John",
  "lastname": "Doe",
  "email": "john.doe@example.com",
  "password": "Password123@",
  "phone": "+2348012345678",
  "industry": "oil_gas"
}
```
*Valid `industry` values:* `oil_gas`, `medical_pharma`, `agricultural`, `manufacturing`, `mining`, `others`

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "message": "Registration successful. Please check your email to verify your account.",
  "data": {
    "id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
    "userId": "VHI-4F8A9B2C",
    "firstname": "John",
    "lastname": "Doe",
    "email": "john.doe@example.com"
  }
}
```

---

### 2.2 Verify Email Address
Verifies the customer account using the token from the email link.

- **Method:** `GET`
- **URL:** `/api/client/auth/verify-email?token=TOKEN_FROM_EMAIL`
- **Auth:** Public

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Email verified successfully. You can now log in."
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `400` | Token invalid or not found |
| `410` | Token expired — user must request a new verification email |

---

### 2.3 Customer Login
Logs in the user and returns the JWT access token.

- **Method:** `POST`
- **URL:** `/api/client/auth/login`
- **Auth:** Public

#### Request Body
```json
{
  "email": "john.doe@example.com",
  "password": "Password123@"
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "customer": {
      "id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
      "userId": "VHI-4F8A9B2C",
      "firstname": "John",
      "lastname": "Doe",
      "email": "john.doe@example.com",
      "industry": "oil_gas",
      "status": "lead"
    }
  }
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `401` | Invalid credentials |
| `401` | Account not verified — check email first |

---

### 2.4 Forgot Password
Sends a password reset link to the customer's email. Always returns 200 regardless of whether the email exists — this prevents account enumeration.

- **Method:** `POST`
- **URL:** `/api/client/auth/forgot-password`
- **Auth:** Public

#### Request Body
```json
{
  "email": "john.doe@example.com"
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "If an account exists with that email, a password reset link has been sent."
}
```

> **Note:** The reset link sent to the user's email points to `CLIENT_FRONTEND_URL/reset-password?token=xxx`. The frontend is responsible for rendering that page, reading the token from the URL, and calling the reset-password endpoint below.

---

### 2.5 Reset Password
Resets the customer's password using the token from the reset email. Token expires after 1 hour.

- **Method:** `POST`
- **URL:** `/api/client/auth/reset-password`
- **Auth:** Public

#### Request Body
```json
{
  "token": "TOKEN_FROM_EMAIL_LINK",
  "password": "NewPassword123@"
}
```
*`password` minimum 8 characters.*

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Password reset successfully. You can now log in."
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `400` | Token invalid, not found, or wrong type |
| `410` | Token expired — user must request a new reset email |

---

## 3. Shipments API (`/api/client/shipments`)

### 3.1 List My Shipments
Gets all shipments created by the logged-in customer.

- **Method:** `GET`
- **URL:** `/api/client/shipments?page=1&pageSize=10`
- **Auth:** Customer Token Required

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": "s-101",
      "orderId": "VHI-AIR-10000",
      "shippingMode": "air_freight",
      "deliveryMode": "door_to_door",
      "natureOfItem": "Industrial Motors",
      "originAddress": "Shenzhen, China",
      "destinationAddress": "Ikeja, Lagos, Nigeria",
      "invoiceValue": 4500000,
      "invoiceCurrency": "NGN",
      "weight": 120.5,
      "weightUnit": "kg",
      "status": "in_transit",
      "createdAt": "2026-08-25T14:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "pageSize": 10,
    "totalPages": 1
  }
}
```

---

### 3.2 Get Single Shipment
Gets the full detail of one shipment including items and tracking updates.

- **Method:** `GET`
- **URL:** `/api/client/shipments/:orderId`
- **Auth:** Customer Token Required

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
    "orderId": "VHI-AIR-10000",
    "status": "pending",
    "shippingMode": "air_freight",
    "deliveryMode": "door_to_door",
    "natureOfItem": "Industrial Motors",
    "originAddress": "Shenzhen, China",
    "destinationAddress": "Ikeja, Lagos, Nigeria",
    "invoiceValue": 4500000,
    "invoiceCurrency": "NGN",
    "countryOfOrigin": "China",
    "exWorkType": "vhi_pickup",
    "originEmail": "sender@example.com",
    "originPhone": "+8612345678",
    "destinationEmail": "receiver@example.com",
    "destinationPhone": "+2348012345678",
    "createdAt": "2026-08-25T14:30:00.000Z",
    "updatedAt": "2026-08-25T14:30:00.000Z",
    "items": [
      {
        "id": "item-uuid",
        "description": "Main Unit Box A",
        "category": "Electronics",
        "quantity": 2,
        "weight": 50,
        "dimensionL": 100,
        "dimensionW": 60,
        "dimensionH": 40,
        "dimensionUnit": "cm"
      }
    ],
    "trackingUpdates": [
      {
        "status": "pending",
        "message": "Shipment booking confirmed.",
        "createdAt": "2026-08-25T14:30:00.000Z"
      }
    ]
  }
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `404` | Shipment not found or does not belong to this customer |

---

### 3.3 Book a New Shipment
Submits a new shipment request with cargo details and optional document files.

- **Method:** `POST`
- **URL:** `/api/client/shipments`
- **Auth:** Customer Token Required
- **Content-Type:** `multipart/form-data`

> **Export shipments use this same endpoint** — just pass `shippingMode: 'export'`. There is no separate export endpoint.

#### Form Data Fields
| Field | Type | Required | Description |
|---|---|---|---|
| `shippingMode` | string | Yes | `'air_freight'`, `'sea_freight'`, `'groupage'`, `'consolidation'`, `'china_groupage'`, `'cargo_clearing'`, `'export'` |
| `deliveryMode` | string | Yes | `'door_to_door'`, `'port_to_port'`, `'port_to_door'`, `'office_pickup'` |
| `natureOfItem` | string | Yes | Cargo item summary |
| `originAddress` | string | Yes | Pickup location |
| `destinationAddress` | string | Yes | Delivery location |
| `originEmail` | string | No | Sender email address |
| `originPhone` | string | No | Sender phone number |
| `destinationEmail` | string | No | Receiver email address |
| `destinationPhone` | string | No | Receiver phone number |
| `countryOfOrigin` | string | No | Country of origin |
| `exWorkType` | string | No | `'vhi_pickup'` or `'supplier_dropoff'` |
| `invoiceValue` | number | No | Estimated value (default: `0`) |
| `invoiceCurrency` | string | No | Currency (default: `'NGN'`) |
| `items` | string (JSON) | Yes | JSON string array of item details — see example below |
| `documents` | file[] | No | Up to 4 files (PDF/PNG/JPG) |

#### Example `items` JSON String Field
```json
[
  {
    "description": "Main Unit Box A",
    "category": "Electronics",
    "quantity": 2,
    "weight": 50,
    "dimensionL": 100,
    "dimensionW": 60,
    "dimensionH": 40,
    "dimensionUnit": "cm"
  }
]
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "orderId": "VHI-AIR-10115",
    "status": "pending",
    "shippingMode": "air_freight",
    "natureOfItem": "Medical Monitors",
    "originAddress": "Shanghai, China",
    "destinationAddress": "Victoria Island, Lagos",
    "invoiceValue": 4500000,
    "invoiceCurrency": "NGN",
    "createdAt": "2026-09-01T17:00:00.000Z"
  }
}
```

---

### 3.4 Update a Shipment
Updates a pending shipment. Only allowed while `status = 'pending'`.

- **Method:** `PUT`
- **URL:** `/api/client/shipments/:orderId`
- **Auth:** Customer Token Required
- **Content-Type:** `application/json`

#### Request Body
All fields are optional — send only what needs to change. Admin-owned fields (`status`, `awbNumber`, `bolNumber`, `portOfDischarge`) are silently ignored even if sent.

```json
{
  "natureOfItem": "Updated item description",
  "destinationAddress": "New delivery address",
  "invoiceValue": 6000000
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": { ...updatedShipment }
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `403` | Shipment cannot be modified after processing has begun |
| `404` | Shipment not found or does not belong to this customer |

---

### 3.5 Cancel a Shipment
Cancels a pending shipment by setting its status to `'cancelled'`. The record is never deleted.

- **Method:** `DELETE`
- **URL:** `/api/client/shipments/:orderId`
- **Auth:** Customer Token Required

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Shipment cancelled successfully."
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `403` | Shipment cannot be modified after processing has begun |
| `404` | Shipment not found or does not belong to this customer |

---

## 4. Tracking API

### 4.1 Track My Shipment (Authenticated)
Returns full tracking detail for a shipment owned by the logged-in customer.

- **Method:** `GET`
- **URL:** `/api/client/tracking/:orderId`
- **Auth:** Customer Token Required

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "orderId": "VHI-AIR-10000",
    "status": "in_transit",
    "shippingMode": "air_freight",
    "deliveryMode": "door_to_door",
    "natureOfItem": "Industrial Motors",
    "originAddress": "Shenzhen, China",
    "destinationAddress": "Ikeja, Lagos, Nigeria",
    "totalWeight": 120.5,
    "weightUnit": "kg",
    "createdAt": "2026-08-25T14:30:00.000Z",
    "trackingUpdates": [
      {
        "status": "pending",
        "message": "Shipment booking confirmed.",
        "createdAt": "2026-08-25T14:30:00.000Z"
      },
      {
        "status": "in_transit",
        "message": "Flight departed origin hub.",
        "createdAt": "2026-08-27T08:15:00.000Z"
      }
    ]
  }
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `404` | Shipment not found or does not belong to this customer |

---

### 4.2 Public Tracking (No Login)
For visitors tracking packages directly on the public homepage using AWB / BoL / Unique ID.

- **Method:** `GET`
- **URL:** `/api/tracking/:trackingId`
- **Auth:** Public (No token needed)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "orderId": "VHI-AIR-10000",
    "status": "in_transit",
    "awbNumber": "157-40000000",
    "shippingMode": "air_freight",
    "trackingUpdates": [
      {
        "status": "pending",
        "message": "Shipment booking confirmed.",
        "createdAt": "2026-08-25T14:30:00.000Z"
      },
      {
        "status": "in_transit",
        "message": "Flight departed origin hub.",
        "createdAt": "2026-08-27T08:15:00.000Z"
      }
    ]
  }
}
```

---

## 5. Cargo Clearings API (`/api/client/cargo-clearings`)

### 5.1 List My Cargo Clearings
Gets all cargo clearing submissions by the logged-in customer.

- **Method:** `GET`
- **URL:** `/api/client/cargo-clearings?page=1&pageSize=10`
- **Auth:** Customer Token Required

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "clearingType": "air_clearing",
      "description": "Industrial compressors",
      "awbNumber": "157-887777",
      "invoiceValue": 12000000,
      "invoiceCurrency": "NGN",
      "commodityHsCode": "84143090",
      "weight": 132.56,
      "weightUnit": "kg",
      "deliveryMode": "door_to_door",
      "deliveryAddress": "Ikeja, Lagos",
      "status": "pending",
      "airwayBillUrl": "https://res.cloudinary.com/...",
      "finalInvoiceUrl": null,
      "createdAt": "2026-09-01T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "pageSize": 10,
    "totalPages": 1
  }
}
```

---

### 5.2 Get Single Cargo Clearing
Gets the full detail of one cargo clearing submission.

- **Method:** `GET`
- **URL:** `/api/client/cargo-clearings/:id`
- **Auth:** Customer Token Required

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "clearingType": "air_clearing",
    "description": "Industrial compressors",
    "awbNumber": "157-887777",
    "invoiceValue": 12000000,
    "invoiceCurrency": "NGN",
    "commodityHsCode": "84143090",
    "weight": 132.56,
    "weightUnit": "kg",
    "deliveryMode": "door_to_door",
    "deliveryAddress": "Ikeja, Lagos",
    "status": "pending",
    "airwayBillUrl": "https://res.cloudinary.com/...",
    "finalInvoiceUrl": "https://res.cloudinary.com/...",
    "createdAt": "2026-09-01T10:00:00.000Z",
    "updatedAt": "2026-09-01T10:00:00.000Z"
  }
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `404` | Cargo clearing not found or does not belong to this customer |

---

### 5.3 Submit a Cargo Clearing
Submits a new cargo clearing request with optional document files.

- **Method:** `POST`
- **URL:** `/api/client/cargo-clearings`
- **Auth:** Customer Token Required
- **Content-Type:** `multipart/form-data`

#### Form Data Fields
| Field | Type | Required | Description |
|---|---|---|---|
| `clearingType` | string | Yes | `'air_clearing'` or `'sea_clearing'` |
| `description` | string | Yes | Exact nature of the cargo |
| `awbNumber` | string | No | Airway Bill number |
| `invoiceValue` | number | No | Invoice value (default: `0`) |
| `invoiceCurrency` | string | No | Currency (default: `'NGN'`) |
| `commodityHsCode` | string | No | HS code for customs |
| `weight` | number | No | Cargo weight |
| `weightUnit` | string | No | `'kg'` or `'cbm'` (default: `'kg'`) |
| `deliveryMode` | string | No | Delivery mode |
| `deliveryAddress` | string | No | Final delivery address |
| `airwayBill` | file | No | Airway Bill PDF |
| `finalInvoice` | file | No | Final Invoice PDF |

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "clearingType": "air_clearing",
    "description": "Industrial compressors",
    "status": "pending",
    "airwayBillUrl": "https://res.cloudinary.com/...",
    "finalInvoiceUrl": null,
    "createdAt": "2026-09-01T10:00:00.000Z"
  }
}
```

---

### 5.4 Update a Cargo Clearing
Updates a pending cargo clearing. Only allowed while `status = 'pending'`.

- **Method:** `PUT`
- **URL:** `/api/client/cargo-clearings/:id`
- **Auth:** Customer Token Required
- **Content-Type:** `application/json`

#### Request Body
All fields optional — send only what needs to change.

```json
{
  "description": "Updated cargo description",
  "deliveryAddress": "New delivery address",
  "weight": 150.00
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": { ...updatedCargoClearing }
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `403` | Cargo clearing cannot be modified after processing has begun |
| `404` | Cargo clearing not found or does not belong to this customer |

---

### 5.5 Cancel a Cargo Clearing
Cancels a pending cargo clearing by setting its status to `'cancelled'`. The record is never deleted.

- **Method:** `DELETE`
- **URL:** `/api/client/cargo-clearings/:id`
- **Auth:** Customer Token Required

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Cargo clearing cancelled successfully."
}
```

#### Error Responses
| Status | Meaning |
|---|---|
| `403` | Cargo clearing cannot be modified after processing has begun |
| `404` | Cargo clearing not found or does not belong to this customer |

---

## 6. Payments API (`/api/payments`)

### 6.1 Initialize Online Payment (Paystack / Stripe)
Creates a checkout payment link for an invoice.

- **Method:** `POST`
- **URL:** `/api/payments/initialize`
- **Auth:** Public / Customer Token

#### Request Body
```json
{
  "invoiceId": "inv-12345",
  "paymentMethod": "paystack",
  "callbackUrl": "http://localhost:5173/payment-success"
}
```
*Valid `paymentMethod` values:* `'paystack'`, `'stripe'`

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://checkout.paystack.com/39a0b1c2d3...",
    "reference": "VHI-PAY-1788290",
    "amount": 4500000,
    "currency": "NGN"
  }
}
```

---

### 6.2 Verify Online Payment
Confirms that payment succeeded and marks the invoice as paid.

- **Method:** `POST`
- **URL:** `/api/payments/verify`
- **Auth:** Public

#### Request Body
```json
{
  "reference": "VHI-PAY-1788290",
  "invoiceId": "inv-12345"
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "status": "paid",
    "invoiceId": "inv-12345",
    "amountPaid": 4500000
  }
}
```

---

## 7. Customer Feedback API

### 7.1 Submit Feedback
Allows customers to leave star ratings and comments.

- **Method:** `POST`
- **URL:** `/api/admin/feedback`
- **Auth:** Public / Customer

#### Request Body
```json
{
  "customerId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
  "shipmentId": "s-101",
  "rating": 5,
  "comment": "Fast clearance and delivery in Lagos. Excellent service!"
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "message": "Feedback submitted successfully"
}
```

---

## 8. Frontend TypeScript Types (Copy & Paste)

```typescript
export type ShippingMode =
  | 'air_freight'
  | 'sea_freight'
  | 'groupage'
  | 'consolidation'
  | 'china_groupage'
  | 'cargo_clearing'
  | 'export';

export type ShipmentStatus =
  | 'draft'
  | 'pending'
  | 'processing'
  | 'in_transit'
  | 'clearance'
  | 'delivered'
  | 'cancelled';

export type ClearingType = 'air_clearing' | 'sea_clearing';

export type Industry =
  | 'oil_gas'
  | 'medical_pharma'
  | 'agricultural'
  | 'manufacturing'
  | 'mining'
  | 'others';

export interface CustomerUser {
  id: string;
  userId: string;
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;
  industry?: Industry;
  status: 'lead' | 'prospect' | 'returning' | 'loyal';
}

export interface TrackingStep {
  status: ShipmentStatus;
  message: string;
  createdAt: string;
}

export interface ShipmentItem {
  id: string;
  description: string;
  category: string;
  quantity: number;
  weight: number;
  dimensionL: number;
  dimensionW: number;
  dimensionH: number;
  dimensionUnit: 'mm' | 'cm' | 'inches';
}

export interface ClientShipment {
  id: string;
  orderId: string;
  shippingMode: ShippingMode;
  deliveryMode: string;
  natureOfItem: string;
  originAddress: string;
  destinationAddress: string;
  originEmail?: string;
  originPhone?: string;
  destinationEmail?: string;
  destinationPhone?: string;
  countryOfOrigin?: string;
  exWorkType?: string;
  invoiceValue: number;
  invoiceCurrency: string;
  weight: number;
  weightUnit: string;
  status: ShipmentStatus;
  awbNumber?: string;
  bolNumber?: string;
  createdAt: string;
  updatedAt: string;
  items?: ShipmentItem[];
  trackingUpdates?: TrackingStep[];
}

export interface CargoClearing {
  id: string;
  clearingType: ClearingType;
  description: string;
  awbNumber?: string;
  invoiceValue: number;
  invoiceCurrency: string;
  commodityHsCode?: string;
  weight?: number;
  weightUnit: string;
  deliveryMode?: string;
  deliveryAddress?: string;
  status: ShipmentStatus;
  airwayBillUrl?: string;
  finalInvoiceUrl?: string;
  createdAt: string;
  updatedAt: string;
}
```