import { formatStatusLabel, getShipmentStatusColor, getInvoiceStatusColor, getCustomerStatusColor } from '@/utils/statusColors';

interface BadgeProps {
  status: string;
  type?: 'shipment' | 'invoice' | 'customer';
  size?: 'sm' | 'md';
}

export function Badge({ status, type = 'shipment', size = 'md' }: BadgeProps) {
  let colors;
  switch (type) {
    case 'invoice':
      colors = getInvoiceStatusColor(status);
      break;
    case 'customer':
      colors = getCustomerStatusColor(status);
      break;
    default:
      colors = getShipmentStatusColor(status);
  }

  const padding = size === 'sm' ? '4px 10px' : '6px 14px';
  const fontSize = size === 'sm' ? '0.6875rem' : '0.75rem';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding,
        borderRadius: 'var(--radius-badge)',
        fontSize,
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
        whiteSpace: 'nowrap',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {formatStatusLabel(status)}
    </span>
  );
}
