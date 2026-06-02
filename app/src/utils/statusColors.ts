import type { ShipmentStatus, InvoiceStatus, CustomerStatus } from '@/types';

export interface StatusColor {
  bg: string;
  text: string;
}

export function getShipmentStatusColor(status: ShipmentStatus | string): StatusColor {
  const map: Record<string, StatusColor> = {
    delivered: { bg: 'var(--color-status-delivered-bg)', text: 'var(--color-status-delivered-text)' },
    in_transit: { bg: 'var(--color-status-in-transit-bg)', text: 'var(--color-status-in-transit-text)' },
    pending: { bg: 'var(--color-status-pending-bg)', text: 'var(--color-status-pending-text)' },
    processing: { bg: 'var(--color-status-processing-bg)', text: 'var(--color-status-processing-text)' },
    cancelled: { bg: 'var(--color-status-cancelled-bg)', text: 'var(--color-status-cancelled-text)' },
    draft: { bg: 'var(--color-status-cancelled-bg)', text: 'var(--color-status-cancelled-text)' },
    clearance: { bg: '#E3F2FD', text: '#1565C0' },
  };
  return map[status] || { bg: 'var(--color-status-cancelled-bg)', text: 'var(--color-status-cancelled-text)' };
}

export function getInvoiceStatusColor(status: InvoiceStatus | string): StatusColor {
  const map: Record<string, StatusColor> = {
    paid: { bg: 'var(--color-status-delivered-bg)', text: 'var(--color-status-delivered-text)' },
    draft: { bg: 'var(--color-status-cancelled-bg)', text: 'var(--color-status-cancelled-text)' },
    sent: { bg: '#E3F2FD', text: '#1565C0' },
    pending: { bg: 'var(--color-status-pending-bg)', text: 'var(--color-status-pending-text)' },
    awaiting_vendor: { bg: '#FFF3E0', text: '#E65100' },
    awaiting_vendor_feedback: { bg: '#FFF3E0', text: '#E65100' },
    part_paid: { bg: 'var(--color-status-processing-bg)', text: 'var(--color-status-processing-text)' },
  };
  return map[status] || { bg: 'var(--color-status-cancelled-bg)', text: 'var(--color-status-cancelled-text)' };
}

export function getCustomerStatusColor(status: CustomerStatus | string): StatusColor {
  const map: Record<string, StatusColor> = {
    lead: { bg: 'var(--color-status-cancelled-bg)', text: 'var(--color-status-cancelled-text)' },
    prospect: { bg: 'var(--color-status-processing-bg)', text: 'var(--color-status-processing-text)' },
    returning: { bg: '#E3F2FD', text: '#1565C0' },
    loyal: { bg: 'var(--color-status-delivered-bg)', text: 'var(--color-status-delivered-text)' },
  };
  return map[status] || { bg: 'var(--color-status-cancelled-bg)', text: 'var(--color-status-cancelled-text)' };
}

export function formatStatusLabel(status: string): string {
  if (!status) return 'Unknown';
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
