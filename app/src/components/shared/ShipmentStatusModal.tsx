import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { shipmentService } from '@/services/shipment.service';
import type { AllowedTransition, Shipment } from '@/types';

export const formatShipmentStatus = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// Splits the API's allowedTransitions: "update" = forward moves, cancels and reopens; "correct" = one step back.
export function transitionsFor(shipment: Pick<Shipment, 'allowedTransitions'>, mode: 'update' | 'correct'): AllowedTransition[] {
  return (shipment.allowedTransitions ?? []).filter((t) => (mode === 'correct' ? t.isCorrection : !t.isCorrection));
}

// Shared error handling for status changes. Returns true when the shipment changed underneath us (409).
export function reportStatusChangeError(err: any): boolean {
  if (err?.response?.status === 409) {
    alert('This shipment was changed by someone else. It has been reloaded; please review and try again.');
    return true;
  }
  alert(err?.response?.data?.message || 'Failed to update status.');
  return false;
}

interface ShipmentStatusModalProps {
  isOpen: boolean;
  mode: 'update' | 'correct';
  shipment: Pick<Shipment, 'id' | 'status' | 'allowedTransitions'>;
  onClose: () => void;
  // Called after a successful change or a 409 so the parent can reload the shipment.
  onChanged: () => void;
}

export function ShipmentStatusModal({ isOpen, mode, shipment, onClose, onChanged }: ShipmentStatusModalProps) {
  const options = transitionsFor(shipment, mode);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTo('');
      setReason('');
      setMessage('');
    }
  }, [isOpen, shipment.status]);

  const selected = options.find((t) => t.to === to);
  const reasonMissing = !!selected?.requiresReason && !reason.trim();

  const handleSubmit = async () => {
    if (!selected || reasonMissing) return;
    setSaving(true);
    try {
      await shipmentService.updateStatus(shipment.id, selected.to, message || undefined, {
        reason: reason.trim() || undefined,
        expectedStatus: shipment.status,
      });
      onClose();
      onChanged();
    } catch (err) {
      console.error('Failed to update status', err);
      if (reportStatusChangeError(err)) {
        onClose();
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'correct' ? 'Correct Status' : 'Update Status'}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !selected || reasonMissing}>
            {saving ? 'Saving...' : mode === 'correct' ? 'Correct Status' : 'Update Status'}
          </button>
        </>
      }
    >
      {mode === 'correct' && (
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          Moves the shipment back one step to fix a mistake. Customers are not notified of corrections.
        </p>
      )}
      <div className="form-group">
        <label className="form-label">
          {mode === 'correct' ? 'Correct to' : 'New status'} (currently {formatShipmentStatus(shipment.status)})
        </label>
        {options.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>No status changes are available for your role.</p>
        ) : (
          <CustomSelect
            value={to}
            onChange={setTo}
            options={options.map((t) => ({ value: t.to, label: formatShipmentStatus(t.to) }))}
            placeholder="Select status..."
            width="100%"
          />
        )}
      </div>
      {selected?.requiresReason && (
        <div className="form-group">
          <label className="form-label" htmlFor="status-change-reason">
            {selected.to === 'cancelled' ? 'Reason (shown to the customer)' : 'Reason (internal, not shown to the customer)'}
          </label>
          <textarea
            id="status-change-reason"
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby="status-change-reason-help"
            placeholder={selected.to === 'cancelled' ? 'Why is this shipment being cancelled?' : 'Why is this change needed?'}
            rows={2}
            style={{ resize: 'vertical', width: '100%' }}
          />
          <p id="status-change-reason-help" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
            {selected.to === 'cancelled'
              ? 'The customer will see this reason in their cancellation notification.'
              : 'Kept in the audit log only. Customers are not notified of corrections.'}
          </p>
        </div>
      )}
      {mode === 'update' && (
        <div className="form-group">
          <label className="form-label">Tracking message (optional)</label>
          <textarea
            className="input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Arrived at transit hub, Paris..."
            rows={3}
            style={{ resize: 'vertical', width: '100%' }}
          />
        </div>
      )}
    </Modal>
  );
}
