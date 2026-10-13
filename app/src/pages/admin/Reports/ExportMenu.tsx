import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, FileSpreadsheet, FileText, FileType2, Loader2 } from 'lucide-react';
import { reportErrorMessage, reportService } from '@/services/report.service';
import type { Capabilities, ExportFormat, ExportSection, ReportFilterParams } from '@/services/report.service';

// Exports exactly what the page shows: the same filters, and only the sections this role may see (the server enforces it too).

const FORMATS: Array<{ value: ExportFormat; label: string; icon: typeof FileText }> = [
  { value: 'pdf', label: 'PDF', icon: FileText },
  { value: 'docx', label: 'Word (.docx)', icon: FileType2 },
  { value: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
];

export function ExportMenu({ filters, capabilities, today, disabled }: { filters: ReportFilterParams; capabilities: Capabilities; today?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setError(null);
    try {
      const sections: ExportSection[] = capabilities.revenue ? ['summary', 'shipments', 'revenue', 'customers'] : ['summary', 'shipments', 'customers'];
      const { blob, filename } = await reportService.exportReport(format, sections, filters, today);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(await reportErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="btn btn-primary btn-sm" disabled={disabled || busy !== null} aria-busy={busy !== null}>
            {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {busy ? 'Preparing...' : 'Export'}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="rpt-menu" align="end" sideOffset={6}>
            {FORMATS.map(({ value, label, icon: Icon }) => (
              <DropdownMenu.Item key={value} className="rpt-menu-item" onSelect={() => run(value)}>
                <Icon size={16} aria-hidden="true" /> {label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && <p className="rpt-note" role="alert" style={{ color: '#8E1F1A', maxWidth: 320, textAlign: 'right' }}>{error}</p>}
    </div>
  );
}
