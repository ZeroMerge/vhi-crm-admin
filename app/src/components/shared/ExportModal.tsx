import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/switch';
import { FileText, FileSpreadsheet, Check } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount?: number;
  rows?: Array<Record<string, unknown>>;
  fileName?: string;
}

const csvFriendlyValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const normalized = String(value);
  if (/[,\n"]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
};

export function ExportModal({ isOpen, onClose, selectedCount = 0, rows = [], fileName = 'vhi_export.csv' }: ExportModalProps) {
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
  const [includePrice, setIncludePrice] = useState(true);
  const [includeShipper, setIncludeShipper] = useState(true);
  const [includeItems, setIncludeItems] = useState(false);

  const handleExport = () => {
    if (format === 'csv') {
      const filteredRows = rows.map((row) => {
        const nextRow: Record<string, unknown> = {};
        Object.entries(row).forEach(([key, value]) => {
          if (!includePrice && key === 'price') return;
          if (!includeShipper && key === 'shipper') return;
          if (!includeItems && key === 'items') return;
          nextRow[key] = value;
        });
        return nextRow;
      });

      const headers = filteredRows.length > 0 ? Object.keys(filteredRows[0]) : ['id', 'status'];
      const csvLines = [headers.join(','), ...filteredRows.map((row) => headers.map((header) => csvFriendlyValue(row[header])).join(','))];
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const encodedUri = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(encodedUri);
    } else {
      window.print();
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Data"
      maxWidth="560px"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleExport}>
            Generate &amp; Download
          </button>
        </>
      }
    >
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
        {selectedCount > 0
          ? `Choose your preferred document format and customize the data fields to include for the ${selectedCount} selected shipment${selectedCount !== 1 ? 's' : ''}.`
          : 'Choose your preferred document format and customize the data fields to include for all shipments.'}
      </p>

      {/* Horizontal Format Cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
        {/* PDF Option */}
        <button
          onClick={() => setFormat('pdf')}
          style={{
            flex: 1,
            padding: '16px 18px',
            borderRadius: 'var(--radius-card)',
            border: format === 'pdf' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
            background: format === 'pdf' ? 'var(--color-primary-light)' : 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transition: 'all 0.15s ease',
            textAlign: 'left',
            outline: 'none',
          }}
        >
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-input)',
            background: format === 'pdf' ? 'white' : 'var(--color-surface)',
            color: 'var(--color-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: format === 'pdf' ? 'none' : '1px solid var(--color-border)'
          }}>
            <FileText size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
              PDF File
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Best for printing
            </div>
          </div>
          <div style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: `2px solid ${format === 'pdf' ? 'var(--color-primary)' : 'var(--color-text-muted)'}`,
            background: format === 'pdf' ? 'var(--color-primary)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            flexShrink: 0,
          }}>
            {format === 'pdf' && <Check size={10} strokeWidth={3} />}
          </div>
        </button>

        {/* CSV Option */}
        <button
          onClick={() => setFormat('csv')}
          style={{
            flex: 1,
            padding: '16px 18px',
            borderRadius: 'var(--radius-card)',
            border: format === 'csv' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
            background: format === 'csv' ? 'var(--color-primary-light)' : 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transition: 'all 0.15s ease',
            textAlign: 'left',
            outline: 'none',
          }}
        >
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-input)',
            background: format === 'csv' ? 'white' : 'var(--color-surface)',
            color: 'var(--color-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: format === 'csv' ? 'none' : '1px solid var(--color-border)'
          }}>
            <FileSpreadsheet size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
              CSV/Excel
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Best for analysis
            </div>
          </div>
          <div style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: `2px solid ${format === 'csv' ? 'var(--color-primary)' : 'var(--color-text-muted)'}`,
            background: format === 'csv' ? 'var(--color-primary)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            flexShrink: 0,
          }}>
            {format === 'csv' && <Check size={10} strokeWidth={3} />}
          </div>
        </button>
      </div>

      {/* Customization section */}
      <div style={{ borderTop: '2px solid var(--color-border)', paddingTop: 24 }}>
        <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 20 }}>
          Data Customization
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
            <Switch
              checked={includePrice}
              onCheckedChange={setIncludePrice}
            />
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Include Price &amp; Billing Details
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
            <Switch
              checked={includeShipper}
              onCheckedChange={setIncludeShipper}
            />
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Include Shipper/Carrier Information
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
            <Switch
              checked={includeItems}
              onCheckedChange={setIncludeItems}
            />
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Include Full Itemized List
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
