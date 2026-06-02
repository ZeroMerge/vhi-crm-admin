import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, AlertTriangle, X } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/utils/formatCurrency';
import { trackingService } from '@/services/tracking.service';
import { shipmentService } from '@/services/shipment.service';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Shipment } from '@/types';

const filters = [
  { value: '', label: 'All Shipments' },
  { value: 'missing', label: 'Missing Tracking ID' },
  { value: 'has_awb', label: 'Has AWB' },
  { value: 'has_bol', label: 'Has BoL' },
  { value: 'has_unique', label: 'Has Unique ID' },
];

const modes = [
  { value: '', label: 'All Modes' },
  { value: 'air_freight', label: 'Air Freight' },
  { value: 'sea', label: 'Sea (Groupage/Consolidation/China)' },
  { value: 'cargo_clearing', label: 'Cargo Clearing' },
  { value: 'export', label: 'Export' },
];

export default function Tracking() {
  const admin = useAuthStore((s) => s.admin);
  const isSupportStaff = admin?.activeRole === 'support_staff';
  const isMobile = useIsMobile();

  const [searchParams, setSearchParams] = useSearchParams();

  // Read filter state from URL parameters
  const search = searchParams.get('search') || '';
  const filter = searchParams.get('filter') || '';
  const mode = searchParams.get('mode') || '';

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingType, setTrackingType] = useState<'awb' | 'bol' | 'uniqueId'>('awb');
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchTrackingList = async () => {
      setLoading(true);
      try {
        const data = await trackingService.list({ search, filter, mode });
        if (active) {
          setShipments(data);
          if (data.length > 0) {
            // Find currently selected shipment in the new list, or default to the first one
            const currentSelected = selectedShipment
              ? data.find((s) => s.id === selectedShipment.id) || data[0]
              : data[0];
            
            setSelectedShipment(currentSelected);
            setTrackingType(getTrackingType(currentSelected));
            setTrackingNumber(
              currentSelected.awbNumber || currentSelected.bolNumber || currentSelected.uniqueId || ''
            );
          } else {
            setSelectedShipment(null);
          }
        }
      } catch (err) {
        console.error('Failed to load tracking list:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchTrackingList();
    return () => {
      active = false;
    };
  }, [search, filter, mode]);

  const getTrackingType = (shipment: Shipment): 'awb' | 'bol' | 'uniqueId' => {
    if (shipment.shippingMode === 'air_freight') return 'awb';
    if (['groupage', 'consolidation', 'china_groupage'].includes(shipment.shippingMode)) return 'uniqueId';
    return 'bol';
  };

  const handleSelectShipment = (shipment: Shipment) => {
    setSelectedShipment(shipment);
    setTrackingType(getTrackingType(shipment));
    setTrackingNumber(shipment.awbNumber || shipment.bolNumber || shipment.uniqueId || '');
  };

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const isFilterActive = !!(search || filter || mode);

  const handleSaveTracking = async () => {
    if (!selectedShipment || isSupportStaff) return;
    if (!trackingNumber.trim()) {
      alert('Please enter a tracking number.');
      return;
    }

    setSaveLoading(true);
    try {
      const data: any = {};
      if (trackingType === 'awb') data.awbNumber = trackingNumber;
      else if (trackingType === 'bol') data.bolNumber = trackingNumber;
      else data.uniqueId = trackingNumber;

      await shipmentService.updateTracking(selectedShipment.id, data);
      alert('Tracking information updated successfully!');
      
      // Refresh the shipment selection
      const updatedShipment = { ...selectedShipment, ...data };
      setSelectedShipment(updatedShipment);
      
      // Trigger list refresh
      window.location.reload();
    } catch (err) {
      console.error('Failed to update tracking:', err);
      alert('Failed to update tracking info.');
    } finally {
      setSaveLoading(false);
    }
  };

  const renderDetails = () => {
    if (!selectedShipment) return null;
    return (
      <>
        {/* Header - Only needed on desktop, Modal has its own title on mobile */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 400 }}>
              Order ID: <span style={{ fontWeight: 600 }}>{selectedShipment.orderId}</span>
            </h2>
            <Badge status={selectedShipment.status} type="shipment" />
          </div>
        )}

        {/* Info Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                Shipping Mode
              </span>
            </div>
            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, textTransform: 'capitalize' }}>
              {(selectedShipment.shippingMode ?? '').replace(/_/g, ' ')}
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                Address
              </span>
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {selectedShipment.destinationAddress}
            </div>
          </div>
        </div>

        {/* Tracking Form */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 className="card-title" style={{ marginBottom: 16 }}>Update Tracking Number</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>
                {trackingType === 'awb' ? 'AWB Number' : trackingType === 'bol' ? 'Bill of Lading Number' : 'Unique ID'}
              </label>
              <input
                className="input"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder={`Enter ${trackingType === 'awb' ? 'AWB' : trackingType === 'bol' ? 'BoL' : 'unique'} number...`}
                disabled={isSupportStaff}
              />
            </div>
            {!isSupportStaff && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveTracking}
                disabled={saveLoading}
                style={{ alignSelf: 'flex-start' }}
              >
                {saveLoading ? 'Saving...' : 'Save Tracking Info'}
              </button>
            )}
          </div>
        </div>

        {/* Details and Description */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 16 }}>Shipment details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Nature of Item</div>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 12 }}>{selectedShipment.natureOfItem}</div>
              
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Declared Value</div>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 12 }}>{formatCurrency(selectedShipment.invoiceValue, selectedShipment.invoiceCurrency)}</div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Weight</div>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 12 }}>{(selectedShipment.weight ?? 0).toLocaleString()} {selectedShipment.weightUnit || 'kg'}</div>

              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Origin Address</div>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 12 }}>{selectedShipment.originAddress}</div>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <PageWrapper title="Tracking">
      {/* Search and Filters horizontal panel */}
      <div
        className="filter-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 24,
          flexWrap: 'wrap',
          background: 'var(--color-surface)',
          padding: '16px',
          borderRadius: 'var(--border-radius-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="search-input-wrapper" style={{ maxWidth: 240 }}>
          <Search size={18} className="search-icon" />
          <input
            className="input"
            placeholder="Search order, AWB, BoL, unique ID..."
            value={search}
            onChange={(e) => updateFilter('search', e.target.value)}
          />
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {filter && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-primary)',
                zIndex: 2,
              }}
            />
          )}
          <select
            className="select"
            value={filter}
            onChange={(e) => updateFilter('filter', e.target.value)}
            style={{
              borderColor: filter ? 'var(--color-primary)' : 'var(--color-border)',
              paddingRight: 32,
            }}
          >
            {filters.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {mode && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-primary)',
                zIndex: 2,
              }}
            />
          )}
          <select
            className="select"
            value={mode}
            onChange={(e) => updateFilter('mode', e.target.value)}
            style={{
              borderColor: mode ? 'var(--color-primary)' : 'var(--color-border)',
              paddingRight: 32,
            }}
          >
            {modes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {isFilterActive && (
          <button
            onClick={clearAllFilters}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <X size={16} />
            Clear
          </button>
        )}
      </div>

      {isSupportStaff && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--color-primary-light)',
            color: 'var(--color-primary)',
            padding: '10px 16px',
            borderRadius: 'var(--border-radius-sm)',
            fontSize: 'var(--font-size-xs)',
            marginBottom: '16px',
            fontWeight: 500,
          }}
        >
          <AlertTriangle size={14} />
          <span>You are logged in with the read-only Support Staff role. Action buttons are disabled.</span>
        </div>
      )}

      {/* Grid Layout */}
      <div className="two-col-layout tracking-layout" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '380px 1fr', gap: 24 }}>
        
        {/* Left Panel - Shipment List */}
        <div>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 16 }}>
            Shipments ({shipments.length})
          </h3>
          
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              Loading...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '680px', overflowY: 'auto', paddingRight: '4px' }}>
              {shipments.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', borderRadius: 'var(--border-radius-card)' }}>
                  No shipments matching filters
                </div>
              ) : (
                shipments.map((shipment) => (
                  <button
                    key={shipment.id}
                    onClick={() => handleSelectShipment(shipment)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 16,
                      background: selectedShipment?.id === shipment.id ? 'var(--color-primary-light)' : 'var(--color-page-bg)',
                      border: `1px solid ${selectedShipment?.id === shipment.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--border-radius-card)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-family)',
                      transition: 'all 0.15s ease',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Order ID</span>
                      <Badge status={shipment.status} type="shipment" size="sm" />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', marginBottom: 12 }}>
                      {shipment.orderId}
                    </div>

                    {/* Timeline */}
                    <div className="tracking-timeline" style={{ position: 'relative', paddingLeft: 16 }}>
                      <div className="tracking-timeline-line" style={{ position: 'absolute', left: 3, top: 8, bottom: 8, width: 2, borderLeft: '2px dashed var(--color-border)' }} />
                      {/* Origin */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div className="tracking-timeline-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', marginLeft: -16, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>From</div>
                          <div style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {shipment.originAddress?.split(',')[0] || 'Unknown'}
                          </div>
                        </div>
                      </div>
                      {/* Destination */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="tracking-timeline-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', marginLeft: -16, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>To</div>
                          <div style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {shipment.destinationAddress?.split(',')[0] || 'Unknown'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Detail */}
        {isMobile ? (
          <Modal
            isOpen={!!selectedShipment}
            onClose={() => setSelectedShipment(null)}
            title={selectedShipment ? `Order ID: ${selectedShipment.orderId}` : ''}
          >
            <div style={{ padding: '0 4px 16px' }}>
              {renderDetails()}
            </div>
          </Modal>
        ) : (
          <div className="col-right">
            {selectedShipment ? renderDetails() : (
              <div style={{ padding: '80px', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', borderRadius: 'var(--border-radius-card)', border: '1px solid var(--color-border)' }}>
                No shipment selected. Choose a shipment from the left list.
              </div>
            )}
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
