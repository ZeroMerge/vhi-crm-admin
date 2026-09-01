# VHI Client Portal API Documentation

This guide provides simple, direct instructions for frontend engineers building the **Client Portal / Customer-Facing Website**.

---

## 1. Quick Setup

- **Backend Base URL:** \`http://localhost:5001\` (Development)
- **Data Format:** JSON (\`application/json\`) except file uploads which use \`multipart/form-data\`
- **Auth Header:** Include on all protected customer requests:
  \`\`\`http
  Authorization: Bearer <customer_jwt_token>
  \`\`\`

### Standard Response Format
\`\`\`json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
\`\`\`

### Standard Error Format
\`\`\`json
{
  "success": false,
  "message": "Human readable error reason"
}
\`\`\`

---

## 2. Authentication API (\`/api/client/auth\`)

### 2.1 Register New Account
Creates a customer account and sends a 24-hour verification email.

- **Method:** \`POST\`
- **URL:** \`/api/client/auth/register\`
- **Auth:** Public (No token needed)

#### Request Body
\`\`\`json
{
  "firstname": "John",
  "lastname": "Doe",
  "email": "john.doe@example.com",
  "password": "Password123@",
  "phone": "+2348012345678",
  "industry": "oil_gas"
}
\`\`\`
*Valid \`industry\` values:* \`oil_gas\`, \`medical\`, \`pharma\`, \`agricultural\`, \`manufacturing\`, \`mining\`, \`others\`

#### Success Response (\`201 Created\`)
\`\`\`json
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
\`\`\`

---

### 2.2 Verify Email Address
Verifies the customer account using the token from the email link.

- **Method:** \`GET\`
- **URL:** \`/api/client/auth/verify-email?token=TOKEN_FROM_EMAIL\`
- **Auth:** Public

#### Success Response (\`200 OK\`)
\`\`\`json
{
  "success": true,
  "message": "Email verified successfully. You can now log in."
}
\`\`\`

---

### 2.3 Customer Login
Logs in the user and returns the JWT access token.

- **Method:** \`POST\`
- **URL:** \`/api/client/auth/login\`
- **Auth:** Public

#### Request Body
\`\`\`json
{
  "email": "john.doe@example.com",
  "password": "Password123@"
}
\`\`\`

#### Success Response (\`200 OK\`)
\`\`\`json
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
\`\`\`

---

## 3. Shipments API (\`/api/client/shipments\`)

### 3.1 List My Shipments
Gets all shipments created by the logged-in customer.

- **Method:** \`GET\`
- **URL:** \`/api/client/shipments?page=1&pageSize=10\`
- **Auth:** Customer Token Required

#### Success Response (\`200 OK\`)
\`\`\`json
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
\`\`\`

---

### 3.2 Book a New Shipment
Submits a new shipment request with cargo details and optional document files.

- **Method:** \`POST\`
- **URL:** \`/api/client/shipments\`
- **Auth:** Customer Token Required
- **Content-Type:** \`multipart/form-data\`

#### Form Data Fields
| Field | Type | Required | Description |
|---|---|---|---|
| \`shippingMode\` | string | Yes | \`'air_freight'\`, \`'groupage'\`, \`'consolidation'\`, \`'china_groupage'\`, \`'cargo_clearing'\`, \`'export'\` |
| \`deliveryMode\` | string | Yes | \`'door_to_door'\`, \`'port_to_port'\`, \`'port_to_door'\`, \`'office_pickup'\` |
| \`natureOfItem\` | string | Yes | Cargo item summary (e.g. \`"Medical Monitors"\`) |
| \`originAddress\` | string | Yes | Pickup location |
| \`destinationAddress\` | string | Yes | Delivery location |
| \`originEmail\` | string | No | Sender email address |
| \`originPhone\` | string | No | Sender phone number |
| \`destinationEmail\` | string | No | Receiver email address |
| \`destinationPhone\` | string | No | Receiver phone number |
| \`countryOfOrigin\` | string | No | Country origin (e.g. \`"China"\`, \`"USA"\`) |
| \`invoiceValue\` | number | No | Estimated value (default: \`0\`) |
| \`invoiceCurrency\` | string | No | Currency (default: \`"NGN"\`) |
| \`items\` | string (JSON) | Yes | JSON string array of item dimensions/weights |
| \`documents\` | file[] | No | Up to 4 document files (PDF/PNG/JPG) |

#### Example \`items\` JSON Field:
\`\`\`json
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
\`\`\`

#### Success Response (\`201 Created\`)
\`\`\`json
{
  "success": true,
  "data": {
    "id": "s-202",
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
\`\`\`

---

## 4. Tracking API

### 4.1 Track by Order ID (Customer Portal)
Allows a logged-in customer to see their shipment's full tracking milestone history.

- **Method:** \`GET\`
- **URL:** \`/api/client/tracking/:orderId\` (e.g. \`/api/client/tracking/VHI-AIR-10000\`)
- **Auth:** Customer Token Required

#### Success Response (\`200 OK\`)
\`\`\`json
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
\`\`\`

---

### 4.2 Public Tracking by AWB / BoL / Unique ID (No Login)
For visitors tracking packages directly on the public homepage.

- **Method:** \`GET\`
- **URL:** \`/api/tracking/:trackingId\` (e.g. \`/api/tracking/157-40000000\` or \`/api/tracking/MSCU7000000\`)
- **Auth:** Public (No token needed)

#### Success Response (\`200 OK\`)
\`\`\`json
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
\`\`\`

---

## 5. Payments API (\`/api/payments\`)

### 5.1 Initialize Online Payment (Paystack / Stripe)
Creates a checkout payment link for an invoice.

- **Method:** \`POST\`
- **URL:** \`/api/payments/initialize\`
- **Auth:** Public / Customer Token

#### Request Body
\`\`\`json
{
  "invoiceId": "inv-12345",
  "paymentMethod": "paystack",
  "callbackUrl": "http://localhost:5173/payment-success"
}
\`\`\`
*Valid \`paymentMethod\` values:* \`'paystack'\`, \`'stripe'\`

#### Success Response (\`200 OK\`)
\`\`\`json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://checkout.paystack.com/39a0b1c2d3...",
    "reference": "VHI-PAY-1788290",
    "amount": 4500000,
    "currency": "NGN"
  }
}
\`\`\`

---

### 5.2 Verify Online Payment
Confirms that payment succeeded and marks the invoice as paid.

- **Method:** \`POST\`
- **URL:** \`/api/payments/verify\`
- **Auth:** Public

#### Request Body
\`\`\`json
{
  "reference": "VHI-PAY-1788290",
  "invoiceId": "inv-12345"
}
\`\`\`

#### Success Response (\`200 OK\`)
\`\`\`json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "status": "paid",
    "invoiceId": "inv-12345",
    "amountPaid": 4500000
  }
}
\`\`\`

---

## 6. Customer Feedback API

### 6.1 Submit Feedback Review
Allows customers to leave star ratings and comments.

- **Method:** \`POST\`
- **URL:** \`/api/admin/feedback\`
- **Auth:** Public / Customer

#### Request Body
\`\`\`json
{
  "customerId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
  "shipmentId": "s-101",
  "rating": 5,
  "comment": "Fast clearance and delivery in Lagos. Excellent service!"
}
\`\`\`

#### Success Response (\`201 Created\`)
\`\`\`json
{
  "success": true,
  "message": "Feedback submitted successfully"
}
\`\`\`

---

## 7. Frontend TypeScript Types (Copy & Paste)

\`\`\`typescript
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

export interface CustomerUser {
  id: string;
  userId: string;
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;
  industry?: string;
  status: 'lead' | 'prospect' | 'returning' | 'loyal';
}

export interface TrackingStep {
  status: ShipmentStatus;
  message: string;
  createdAt: string;
}

export interface ClientShipment {
  id: string;
  orderId: string;
  shippingMode: ShippingMode;
  deliveryMode: string;
  natureOfItem: string;
  originAddress: string;
  destinationAddress: string;
  invoiceValue: number;
  invoiceCurrency: string;
  weight: number;
  weightUnit: string;
  status: ShipmentStatus;
  awbNumber?: string;
  bolNumber?: string;
  uniqueId?: string;
  createdAt: string;
  trackingUpdates?: TrackingStep[];
}
\`\`\`
