import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { StarRating } from '@/components/ui/StarRating';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import type { Customer, Shipment, Payment, Communication } from '@/types';

const mockCustomer: Customer = {
  id: '1', userId: 'USR001', firstname: 'Jane', lastname: 'Smith', email: 'jane@vhi.com',
  phone: '+2348012345678', industry: 'oil_gas', starRating: 4, status: 'loyal',
  newsletterPrefs: ['oil_gas'], isActive: true, createdAt: '2024-01-15T10:00:00Z',
};

const mockShipments: Shipment[] = [
  { id: '1', orderId: '#1895-67-fw', customerId: '1', shippingMode: 'air_freight', deliveryMode: 'door_to_door', natureOfItem: 'Building material', invoiceValue: 34000000, invoiceCurrency: 'NGN', weight: 365000, weightUnit: 'kg', originAddress: 'London, UK', destinationAddress: 'Progue, Czech Republic', status: 'delivered', isDraft: false, createdAt: '2024-03-12T10:00:00Z', updatedAt: '2024-03-12T10:00:00Z' },
  { id: '2', orderId: '#2695-77-gw', customerId: '1', shippingMode: 'groupage', deliveryMode: 'port_to_port', natureOfItem: 'Electronics', invoiceValue: 12500000, invoiceCurrency: 'NGN', weight: 50000, weightUnit: 'kg', originAddress: 'Berlin, Germany', destinationAddress: 'Lagos, Nigeria', status: 'in_transit', isDraft: false, createdAt: '2024-04-10T09:00:00Z', updatedAt: '2024-04-10T09:00:00Z' },
];

const mockPayments: Payment[] = [
  { id: '1', invoiceId: 'INV001', customerId: '1', amount: 34000000, currency: 'NGN', paymentMethod: 'paystack', paymentStatus: 'success', gatewayReference: 'PSK-12345', paidAt: '2024-03-15T14:00:00Z', createdAt: '2024-03-15T14:00:00Z' },
  { id: '2', invoiceId: 'INV002', customerId: '1', amount: 12500000, currency: 'NGN', paymentMethod: 'stripe', paymentStatus: 'pending', createdAt: '2024-04-10T09:00:00Z' },
];

const mockMessages: Communication[] = [
  { id: '1', customerId: '1', sentBy: 'admin-1', subject: 'Shipment Update', body: 'Your shipment has been delivered successfully.', isRead: true, createdAt: '2024-03-15T14:00:00Z' },
  { id: '2', customerId: '1', sentBy: 'admin-1', subject: 'Invoice Reminder', body: 'Please find attached your invoice for the recent shipment.', isRead: false, createdAt: '2024-04-10T09:00:00Z' },
];

type TabType = 'shipments' | 'payments' | 'messages';

export default function CustomerDetail() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('shipments');
  const [starRating, setStarRating] = useState(mockCustomer.starRating);
  const [customerStatus, setCustomerStatus] = useState(mockCustomer.status);
  const [showCompose, setShowCompose] = useState(false);
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');

  const tabs: { label: string; value: TabType }[] = [
    { label: 'Shipments', value: 'shipments' },
    { label: 'Payments', value: 'payments' },
    { label: 'Messages', value: 'messages' },
  ];

  return (
    <PageWrapper>
      {/* Back button */}
      <button
        onClick={() => navigate('/admin/customers')}
        className="btn-back"
      >
        <ArrowLeft size={18} />
        Back to Customers
      </button>

      {/* Profile Card */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          {/* Avatar */}
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--color-primary-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-primary)',
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {mockCustomer.firstname[0]}{mockCustomer.lastname[0]}
          </div>

          {/* Info */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 600 }}>
                {mockCustomer.firstname} {mockCustomer.lastname}
              </h1>
              <Badge status={customerStatus} type="customer" />
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              User ID: {mockCustomer.userId} · Joined {formatDate(mockCustomer.createdAt)}
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 'var(--font-size-sm)', flexWrap: 'wrap' }}>
              <span>{mockCustomer.email}</span>
              <span>{mockCustomer.phone}</span>
              <span><Badge status={mockCustomer.industry} type="shipment" size="sm" /></span>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Star Rating:</span>
              <StarRating value={starRating} onChange={setStarRating} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Status:</span>
              <select
                className="select"
                value={customerStatus}
                onChange={(e) => setCustomerStatus(e.target.value as Customer['status'])}
                style={{ minWidth: 140 }}
              >
                <option value="lead">Lead</option>
                <option value="prospect">Prospect</option>
                <option value="returning">Returning</option>
                <option value="loyal">Loyal</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: '10px 20px',
              borderBottom: activeTab === tab.value ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === tab.value ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontWeight: activeTab === tab.value ? 600 : 400,
              fontSize: 'var(--font-size-sm)',
              background: 'none',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab.value ? 'var(--color-primary)' : 'transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'shipments' && (
        <div className="vhi-table-container">
          <table className="vhi-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Date</th>
                <th>Weight</th>
                <th style={{ textAlign: 'right' }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {mockShipments.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{s.orderId}</td>
                  <td><Badge status={s.shippingMode} type="shipment" size="sm" /></td>
                  <td><Badge status={s.status} type="shipment" size="sm" /></td>
                  <td>{formatDate(s.createdAt)}</td>
                  <td>{s.weight.toLocaleString()}{s.weightUnit}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(s.invoiceValue, s.invoiceCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="vhi-table-container">
          <table className="vhi-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice No</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {mockPayments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{p.invoiceId}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(p.amount, p.currency)}</td>
                  <td><Badge status={p.paymentStatus} type="invoice" size="sm" /></td>
                  <td style={{ textTransform: 'capitalize' }}>{p.paymentMethod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'messages' && (
        <div>
          <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={() => setShowCompose(!showCompose)}>
            {showCompose ? 'Cancel' : 'Compose Message'}
          </button>

          {showCompose && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="input" value={messageSubject} onChange={(e) => setMessageSubject(e.target.value)} placeholder="Enter subject..." />
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <textarea
                  className="input"
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder="Type your message..."
                  rows={4}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <button className="btn btn-primary btn-sm">Send Message</button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mockMessages.map((msg) => (
              <div key={msg.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{msg.subject}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{formatDate(msg.createdAt)}</span>
                </div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{msg.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
