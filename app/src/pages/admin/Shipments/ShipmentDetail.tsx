import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, Download, Trash2, Clock, Package, MapPin } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatDate, formatDateTime } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import type { Shipment, TrackingUpdate, ShipmentStatus } from '@/types';

const mockShipment: Shipment = {
  id: 'ship-1',
  orderId: '#1895-67-fw',
  customerId: '1',
  customer: { id: '1', userId: 'USR001', firstname: 'Jane', lastname: 'Smith', email: 'jane@vhi.com', phone: '+2348012345678', industry: 'oil_gas', starRating: 4, status: 'loyal', newsletterPrefs: [], isActive: true, createdAt: '2024-01-15T10:00:00Z' },
  shippingMode: 'air_freight',
  deliveryMode: 'door_to_door',
  natureOfItem: 'Building material',
  hsCode: '392690',
  invoiceValue: 34000000,
  invoiceCurrency: 'NGN',
  weight: 365000,
  weightUnit: 'kg',
  originAddress: '45 Oxford Street, London W1D 2DZ, United Kingdom',
  destinationAddress: '12 Vaclavske namesti, Prague 110 00, Czech Republic',
  originPickupOption: 'vhi_pickup',
  portOfDischarge: 'Heathrow Airport',
  awbNumber: '157-12345670',
  bolNumber: '',
  uniqueId: '',
  status: 'delivered',
  isDraft: false,
  items: [
    { id: 'item-1', shipmentId: 'ship-1', description: 'Ceramic Tiles', quantity: 500, weight: 180000, dimensionL: 60, dimensionW: 60, dimensionH: 10, dimensionUnit: 'cm' },
    { id: 'item-2', shipmentId: 'ship-1', description: 'Steel Rebar', quantity: 200, weight: 185000, dimensionL: 600, dimensionW: 20, dimensionH: 20, dimensionUnit: 'cm' },
  ],
  documents: [
    { id: 'doc-1', shipmentId: 'ship-1', documentType: 'awb', fileUrl: '/docs/awb-1895.pdf', uploadedBy: 'admin', createdAt: '2024-03-10T08:00:00Z' },
    { id: 'doc-2', shipmentId: 'ship-1', documentType: 'packing_list', fileUrl: '/docs/packing-1895.pdf', uploadedBy: 'admin', createdAt: '2024-03-11T09:00:00Z' },
  ],
  trackingUpdates: [
    { id: 'tu-1', shipmentId: 'ship-1', status: 'pending', message: 'Shipment created and awaiting pickup', updatedBy: 'admin-1', createdAt: '2024-03-12T08:00:00Z' },
    { id: 'tu-2', shipmentId: 'ship-1', status: 'processing', message: 'Shipment picked up from origin', updatedBy: 'admin-1', createdAt: '2024-03-12T14:00:00Z' },
    { id: 'tu-3', shipmentId: 'ship-1', status: 'in_transit', message: 'Departed from origin facility', updatedBy: 'admin-1', createdAt: '2024-03-13T06:00:00Z' },
    { id: 'tu-4', shipmentId: 'ship-1', status: 'in_transit', message: 'Arrived at Heathrow Airport', updatedBy: 'admin-1', createdAt: '2024-03-14T10:00:00Z' },
    { id: 'tu-5', shipmentId: 'ship-1', status: 'delivered', message: 'Delivered to destination address', updatedBy: 'admin-1', createdAt: '2024-03-16T16:00:00Z' },
  ],
  createdAt: '2024-03-12T10:00:00Z',
  updatedAt: '2024-03-16T16:00:00Z',
};

const statusOptions: ShipmentStatus[] = ['draft', 'pending', 'processing', 'in_transit', 'clearance', 'delivered', 'cancelled'];

export default function ShipmentDetail() {
  const navigate = useNavigate();
  const [shipment, setShipment] = useState(mockShipment);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState<ShipmentStatus>(shipment.status);
  const [statusMessage, setStatusMessage] = useState('');
  const [awbNumber, setAwbNumber] = useState(shipment.awbNumber || '');
  const [bolNumber, setBolNumber] = useState(shipment.bolNumber || '');
  const [uniqueId, setUniqueId] = useState(shipment.uniqueId || '');

  const handleAddStatus = () => {
    const update: TrackingUpdate = {
      id: `tu-${Date.now()}`,
      shipmentId: shipment.id,
      status: newStatus,
      message: statusMessage,
      updatedBy: 'admin-1',
      createdAt: new Date().toISOString(),
    };
    setShipment({
      ...shipment,
      status: newStatus,
      trackingUpdates: [...(shipment.trackingUpdates || []), update],
    });
    setShowStatusModal(false);
    setStatusMessage('');
  };

  const handleSaveTracking = () => {
    setShipment({ ...shipment, awbNumber, bolNumber, uniqueId });
  };

  const docTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      awb: 'Air Waybill (AWB)',
      bol: 'Bill of Lading (BoL)',
      form_m: 'Form M',
      paar: 'PAAR',
      packing_list: 'Packing List',
      proforma_invoice: 'Proforma Invoice',
      other: 'Other Document',
    };
    return labels[type] || type;
  };

  return (
    <PageWrapper>
      <button onClick={() => navigate('/admin/shipments')} className="btn-back">
        <ArrowLeft size={18} />
        Back to Shipments
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 'var(--font-size-4xl)', fontWeight: 400 }}>{shipment.orderId}</h1>
          <Badge status={shipment.status} type="shipment" />
        </div>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          Created {formatDate(shipment.createdAt)}
        </span>
      </div>

      {/* Two Column Layout */}
      <div className="two-col-layout">
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Shipment Info */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Shipment Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Customer</div>
                <div style={{ fontWeight: 500 }}>{shipment.customer?.firstname} {shipment.customer?.lastname}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Shipping Mode</div>
                <Badge status={shipment.shippingMode} type="shipment" size="sm" />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Delivery Mode</div>
                <div>{shipment.deliveryMode?.replace(/_/g, ' ')}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Nature of Item</div>
                <div>{shipment.natureOfItem}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>HS Code</div>
                <div>{shipment.hsCode || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Invoice Value</div>
                <div style={{ fontWeight: 500 }}>{formatCurrency(shipment.invoiceValue, shipment.invoiceCurrency)}</div>
              </div>
            </div>
          </div>

          {/* Origin / Destination */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Origin & Destination</h3>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <MapPin size={16} color="var(--color-primary)" />
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>From</span>
                </div>
                <div style={{ fontWeight: 500 }}>{shipment.originAddress}</div>
              </div>
              <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch' }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Package size={16} color="var(--color-accent-pink)" />
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>To</span>
                </div>
                <div style={{ fontWeight: 500 }}>{shipment.destinationAddress}</div>
              </div>
            </div>
          </div>

          {/* Weight & Dimensions */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Weight & Dimensions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Total Weight</div>
                <div style={{ fontWeight: 500 }}>{(shipment.weight ?? 0).toLocaleString()} {shipment.weightUnit || ''}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Pickup Option</div>
                <div>{shipment.originPickupOption?.replace(/_/g, ' ') || '-'}</div>
              </div>
            </div>
            {shipment.items && shipment.items.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 8 }}>Items</div>
                {shipment.items.map((item) => (
                  <div key={item.id} style={{ padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontWeight: 500 }}>{item.description}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                      Qty: {item.quantity} · {(item.weight ?? 0).toLocaleString()}kg · {item.dimensionL}x{item.dimensionW}x{item.dimensionH} {item.dimensionUnit}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Documents</h3>
              <button className="btn btn-outline btn-sm">
                <Upload size={14} />
                Upload
              </button>
            </div>
            {shipment.documents && shipment.documents.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shipment.documents.map((doc) => (
                  <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--color-surface)', borderRadius: 'var(--border-radius-sm)' }}>
                    <span style={{ fontSize: 'var(--font-size-sm)' }}>{docTypeLabel(doc.documentType)}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-icon btn-ghost" title="Download"><Download size={16} /></button>
                      <button className="btn btn-icon btn-ghost" title="Delete" style={{ color: 'var(--color-status-pending-text)' }}><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                No documents uploaded
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="col-right" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Tracking Numbers */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Tracking Information</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4, display: 'block' }}>AWB Number</label>
                <input className="input" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} placeholder="Enter AWB number..." />
              </div>
              <div>
                <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4, display: 'block' }}>BoL Number</label>
                <input className="input" value={bolNumber} onChange={(e) => setBolNumber(e.target.value)} placeholder="Enter BoL number..." />
              </div>
              <div>
                <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4, display: 'block' }}>Unique ID</label>
                <input className="input" value={uniqueId} onChange={(e) => setUniqueId(e.target.value)} placeholder="Enter unique ID..." />
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleSaveTracking} style={{ alignSelf: 'flex-start' }}>
                Save Tracking Info
              </button>
            </div>
          </div>

          {/* Status Timeline */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Status Timeline</h3>
              <button className="btn btn-primary btn-sm" onClick={() => setShowStatusModal(true)}>
                Add Update
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {shipment.trackingUpdates?.map((update, idx) => (
                <div key={update.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: 16 }}>
                  {/* Timeline line */}
                  {idx < (shipment.trackingUpdates?.length || 0) - 1 && (
                    <div style={{ position: 'absolute', left: 11, top: 24, width: 2, height: 'calc(100% - 8px)', background: 'var(--color-border)' }} />
                  )}
                  {/* Dot */}
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: idx === 0 ? 'var(--color-primary)' : 'var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Clock size={12} color={idx === 0 ? 'white' : 'var(--color-text-muted)'} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Badge status={update.status} type="shipment" size="sm" />
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{formatDateTime(update.createdAt)}</span>
                    </div>
                    <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{update.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Invoice Card */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Invoice</h3>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Invoice #INV-2024-001</div>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600 }}>{formatCurrency(34000000, 'NGN')}</div>
                <Badge status="paid" type="invoice" size="sm" />
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => navigate('/admin/invoices/INV001')}>
                View Invoice
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Status Update Modal */}
      <Modal
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        title="Add Tracking Update"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setShowStatusModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAddStatus}>Add Update</button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="select" value={newStatus} onChange={(e) => setNewStatus(e.target.value as ShipmentStatus)} style={{ width: '100%' }}>
            {statusOptions.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Message</label>
          <textarea
            className="input"
            value={statusMessage}
            onChange={(e) => setStatusMessage(e.target.value)}
            placeholder="Enter update message..."
            rows={3}
            style={{ resize: 'vertical', width: '100%' }}
          />
        </div>
      </Modal>
    </PageWrapper>
  );
}
