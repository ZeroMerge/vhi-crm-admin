import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, AlertTriangle, X, Box, Plane } from 'lucide-react';
import { format } from 'date-fns';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Modal } from '@/components/ui/Modal';
import { trackingService } from '@/services/tracking.service';
import { shipmentService } from '@/services/shipment.service';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Shipment, TrackingUpdate } from '@/types';

const TIMELINE_STEPS = [
  { value: 'pending', label: 'Order Placed', description: 'Shipment registered' },
  { value: 'processing', label: 'Processing', description: 'Preparing for dispatch' },
  { value: 'in_transit', label: 'In Transit', description: 'On the way' },
  { value: 'clearance', label: 'Customs Clearance', description: 'Awaiting customs' },
  { value: 'delivered', label: 'Delivered', description: 'Package delivered' },
];

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'clearance', label: 'Customs Clearance' },
  { value: 'delivered', label: 'Delivered' },
];

const safeFormatDate = (dateStr: any) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  try {
    return format(date, 'MMM dd, yyyy');
  } catch (e) {
    return '';
  }
};

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

  const search = searchParams.get('search') || '';
  const filter = searchParams.get('filter') || '';
  const mode = searchParams.get('mode') || '';

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingType, setTrackingType] = useState<'awb' | 'bol' | 'uniqueId'>('awb');
  const [saveLoading, setSaveLoading] = useState(false);

  const [events, setEvents] = useState<TrackingUpdate[]>([]);
  const [newEventStatus, setNewEventStatus] = useState('');
  const [newEventMessage, setNewEventMessage] = useState('');
  const [addingEvent, setAddingEvent] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchTrackingList = async () => {
      setLoading(true);
      try {
        const data = await trackingService.list({ search, filter, mode });
        if (active) {
          setShipments(data);
          if (data.length > 0) {
            const currentSelected = selectedShipment
              ? data.find((s) => s.id === selectedShipment.id) || data[0]
              : data[0];
            
            setSelectedShipment(currentSelected);
            setTrackingType(getTrackingType(currentSelected));
            setTrackingNumber(
              currentSelected.awb_number || currentSelected.bol_number || currentSelected.unique_id || ''
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

  useEffect(() => {
    let active = true;
    if (selectedShipment) {
      trackingService.getEvents(selectedShipment.id).then((data) => {
        if (active) setEvents(data);
      }).catch(err => {
        console.error('Failed to get events', err);
      });
    } else {
      setEvents([]);
    }
    return () => { active = false; };
  }, [selectedShipment]);

  const getTrackingType = (shipment: any): 'awb' | 'bol' | 'uniqueId' => {
    if (shipment.shipping_mode === 'air_freight') return 'awb';
    if (['groupage', 'consolidation', 'china_groupage'].includes(shipment.shipping_mode)) return 'uniqueId';
    return 'bol';
  };

  const handleSelectShipment = (shipment: any) => {
    setSelectedShipment(shipment);
    setTrackingType(getTrackingType(shipment));
    setTrackingNumber(shipment.awb_number || shipment.bol_number || shipment.unique_id || '');
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
      
      const updatedShipment = { 
        ...selectedShipment, 
        awb_number: data.awbNumber !== undefined ? data.awbNumber : selectedShipment.awb_number,
        bol_number: data.bolNumber !== undefined ? data.bolNumber : selectedShipment.bol_number,
        unique_id: data.uniqueId !== undefined ? data.uniqueId : selectedShipment.unique_id,
      };
      setSelectedShipment(updatedShipment);
      setShipments((prev) => prev.map(s => s.id === updatedShipment.id ? updatedShipment : s));
    } catch (err) {
      console.error('Failed to update tracking:', err);
      alert('Failed to update tracking info.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedShipment || isSupportStaff) return;
    if (!newEventStatus) {
      alert('Please select a status.');
      return;
    }
    setAddingEvent(true);
    try {
      const updatedShipment = await shipmentService.updateStatus(
        selectedShipment.id,
        newEventStatus,
        newEventMessage
      );

      setSelectedShipment(updatedShipment);
      setShipments((prev) => prev.map(s => s.id === updatedShipment.id ? updatedShipment : s));
      
      setNewEventStatus('');
      setNewEventMessage('');

      const updatedEvents = await trackingService.getEvents(selectedShipment.id);
      setEvents(updatedEvents);

      alert('Package status updated successfully!');
    } catch (err) {
      console.error('Failed to update package status:', err);
      alert('Failed to update status.');
    } finally {
      setAddingEvent(false);
    }
  };

  const renderDetails = () => {
    if (!selectedShipment) return null;
    
    const s = selectedShipment as any;
    const currentStatusIndex = TIMELINE_STEPS.findIndex(step => step.value === s.status);

    return (
      <>
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                Shipment
              </div>
              <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                {s.order_id}
              </h2>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {safeFormatDate(s.created_at)}
              </div>
            </div>
            <Badge status={s.status} type="shipment" />
          </div>
        )}

        <div style={{ 
          background: 'var(--color-surface)', 
          border: '1px solid var(--color-border)', 
          borderRadius: 'var(--border-radius-card)', 
          padding: '16px 20px', 
          marginBottom: 24 
        }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
            {s.origin_address} &rarr; {s.destination_address}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
            {(s.shipping_mode ?? '').replace(/_/g, ' ').toUpperCase()}
            <span style={{ margin: '0 8px', color: 'var(--color-border)' }}>|</span>
            {(s.weight ?? 0).toLocaleString()} {s.weight_unit || 'kg'}
            <span style={{ margin: '0 8px', color: 'var(--color-border)' }}>|</span>
            {s.nature_of_item || 'No Category'}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 24, padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
            <h3 className="card-title" style={{ marginBottom: 0 }}>Tracking Timeline</h3>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Tracking: <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{trackingNumber || 'Not assigned'}</span>
            </div>
          </div>

          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '0 20px 24px 20px', minHeight: '80px' }}>
            <div style={{
              position: 'absolute',
              top: '12px',
              left: '0',
              right: '0',
              height: '4px',
              backgroundColor: 'var(--color-border)',
              zIndex: 1,
            }} />
            
            <div style={{
              position: 'absolute',
              top: '12px',
              left: '0',
              width: `${(Math.max(0, currentStatusIndex) / (TIMELINE_STEPS.length - 1)) * 100}%`,
              height: '4px',
              backgroundColor: 'var(--color-primary)',
              zIndex: 1,
              transition: 'width 0.3s ease',
            }} />

            {TIMELINE_STEPS.map((step, idx) => {
              const isCompleted = idx < currentStatusIndex;
              const isActive = idx === currentStatusIndex;

              return (
                <div key={step.value} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 2, flex: 1, textAlign: 'center' }}>
                  <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: isCompleted ? 'var(--color-primary)' : isActive ? 'var(--color-page-bg)' : 'var(--color-page-bg)',
                    border: `3px solid ${isCompleted || isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isCompleted ? '#ffffff' : isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    boxShadow: isActive ? '0 0 0 4px var(--color-primary-light)' : 'none',
                    transition: 'all 0.3s ease',
                  }}>
                    {isCompleted ? '✓' : isActive ? '●' : ''}
                  </div>

                  <div style={{ marginTop: '12px', padding: '0 8px' }}>
                    <div style={{
                      fontWeight: isActive || isCompleted ? 600 : 500,
                      fontSize: 'var(--font-size-sm)',
                      color: isActive ? 'var(--color-primary)' : isCompleted ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      whiteSpace: 'nowrap',
                    }}>
                      {step.label}
                      {isActive && <span style={{ fontSize: 'var(--font-size-xs)', marginLeft: '4px', color: 'var(--color-primary)', fontWeight: 'bold' }}>• Now</span>}
                    </div>
                    <div style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                      marginTop: '4px',
                      maxWidth: '120px',
                      margin: '4px auto 0 auto',
                    }}>
                      {step.description}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {!isSupportStaff && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24, marginBottom: 24 }}>
            <div className="card" style={{ padding: '20px' }}>
              <h3 className="card-title" style={{ marginBottom: 16 }}>Manage Tracking ID</h3>
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
                  />
                </div>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={handleSaveTracking}
                  disabled={saveLoading}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {saveLoading ? 'Saving...' : 'Update ID'}
                </button>
              </div>
            </div>

            <div className="card" style={{ padding: '20px' }}>
              <h3 className="card-title" style={{ marginBottom: 16 }}>Update Package Status</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>
                    New Status
                  </label>
                  <CustomSelect
                    value={newEventStatus}
                    onChange={(val) => setNewEventStatus(val)}
                    options={statusOptions}
                    placeholder="Select status..."
                    width="100%"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>
                    Status Update Message (Optional)
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Arrived at transit hub, Paris..."
                    value={newEventMessage}
                    onChange={(e) => setNewEventMessage(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleUpdateStatus}
                  disabled={addingEvent || !newEventStatus}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {addingEvent ? 'Updating...' : 'Update Status'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <PageWrapper title="Tracking">
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
          <CustomSelect
            value={filter}
            onChange={(val) => updateFilter('filter', val)}
            options={filters}
            style={{ borderColor: filter ? 'var(--color-primary)' : 'var(--color-border)' }}
          />
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
          <CustomSelect
            value={mode}
            onChange={(val) => updateFilter('mode', val)}
            options={modes}
            style={{ borderColor: mode ? 'var(--color-primary)' : 'var(--color-border)' }}
          />
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

      <div className="two-col-layout tracking-layout" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '380px 1fr', gap: 24 }}>
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
                shipments.map((shipment) => {
                  const sh = shipment as any;
                  return (
                    <button
                      key={sh.id}
                      onClick={() => handleSelectShipment(sh)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '14px 16px',
                        background: selectedShipment?.id === sh.id ? 'var(--color-primary-light)' : 'var(--color-surface)',
                        border: 'none',
                        borderBottom: '1px solid var(--color-border)',
                        borderLeft: selectedShipment?.id === sh.id ? '4px solid var(--color-primary)' : '4px solid transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'var(--font-family)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                          {sh.order_id}
                        </span>
                        <Badge status={sh.status} type="shipment" size="sm" />
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                        {sh.origin_address?.split(',')[0] || 'Unknown'} &rarr; {sh.destination_address?.split(',')[0] || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                        {(sh.shipping_mode ?? '').replace(/_/g, ' ')}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {isMobile ? (
          <Modal
            isOpen={!!selectedShipment}
            onClose={() => setSelectedShipment(null)}
            title={selectedShipment ? `Order ID: ${(selectedShipment as any).order_id}` : ''}
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
