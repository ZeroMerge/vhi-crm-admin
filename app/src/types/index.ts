export type ShippingMode =
  | 'air_freight'
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

export type DeliveryMode =
  | 'door_to_door'
  | 'port_to_port'
  | 'port_to_door'
  | 'clearance_only'
  | 'office_pickup'
  | 'airport_pickup';

export type CustomerStatus = 'lead' | 'prospect' | 'returning' | 'loyal';

export type Industry =
  | 'oil_gas'
  | 'medical'
  | 'pharma'
  | 'agricultural'
  | 'manufacturing'
  | 'mining'
  | 'others';

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'pending'
  | 'awaiting_vendor'
  | 'part_paid'
  | 'paid';

export type PaymentMethod = 'paystack' | 'stripe' | 'manual';
export type PaymentStatus = 'pending' | 'success' | 'failed';

export type AdminRole = 'super_admin' | 'manager' | 'logistics_officer' | 'finance_officer' | 'crm_officer' | 'support_staff';

export interface Admin {
  id: string;
  name: string;
  email: string;
  activeRole: AdminRole;
  assignedRoles: AdminRole[];
  notificationPrefs?: any;
}

export interface Customer {
  id: string;
  userId: string;
  firstname: string;
  lastname: string;
  email: string;
  phone: string;
  industry: Industry;
  starRating: number;
  status: CustomerStatus;
  newsletterPrefs: string[];
  isActive: boolean;
  createdAt: string;
}

export interface ShipmentItem {
  id: string;
  shipmentId: string;
  description: string;
  category?: string;
  quantity: number;
  weight: number;
  dimensionL: number;
  dimensionW: number;
  dimensionH: number;
  dimensionUnit: 'mm' | 'cm' | 'inches';
}

export interface TrackingUpdate {
  id: string;
  shipmentId: string;
  status: string;
  message: string;
  updatedBy: string;
  createdAt: string;
}

export interface ShipmentDocument {
  id: string;
  shipmentId: string;
  documentType: 'awb' | 'bol' | 'form_m' | 'paar' | 'packing_list' | 'proforma_invoice' | 'other';
  fileUrl: string;
  uploadedBy: string;
  createdAt: string;
}

export interface Shipment {
  id: string;
  orderId: string;
  customerId: string;
  customer?: Customer;
  shippingMode: ShippingMode;
  deliveryMode: DeliveryMode;
  natureOfItem: string;
  hsCode?: string;
  invoiceValue: number;
  invoiceCurrency: string;
  weight: number;
  weightUnit: 'kg' | 'lbs' | 'cbm';
  originAddress: string;
  destinationAddress: string;
  originPickupOption?: 'vhi_pickup' | 'supplier_dropoff';
  portOfDischarge?: string;
  awbNumber?: string;
  bolNumber?: string;
  uniqueId?: string;
  status: ShipmentStatus;
  isDraft: boolean;
  items?: ShipmentItem[];
  documents?: ShipmentDocument[];
  trackingUpdates?: TrackingUpdate[];
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  shipmentId: string;
  customerId: string;
  customer?: Customer;
  shipment?: Shipment;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
  notes?: string;
  fileUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  gatewayReference?: string;
  receiptUrl?: string;
  paidAt?: string;
  createdAt: string;
}

export interface Communication {
  id: string;
  customerId: string;
  customer?: Customer;
  sentBy: string;
  subject: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface NewsletterSend {
  id: string;
  subject: string;
  body: string;
  segment: string;
  sentBy: string;
  recipientCount: number;
  sentAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ReportMetrics {
  newUsers: number;
  pendingShipments: number;
  totalEnquiries: number;
  revenue: number;
  shipmentBreakdown: { mode: string; count: number; value: number }[];
  customerBreakdown: { status: string; count: number }[];
}
