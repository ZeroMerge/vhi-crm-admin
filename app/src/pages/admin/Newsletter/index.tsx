import { useNavigate as useReactNavigate } from 'react-router-dom';
import { Send, ChevronRight, MailOpen } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';

interface Segment {
  industry: string;
  label: string;
  count: number;
  lastSent: string;
  color: string;
}

const segments: Segment[] = [
  { industry: 'all', label: 'All Subscribers', count: 156, lastSent: '2024-05-15', color: 'var(--color-primary)' },
  { industry: 'oil_gas', label: 'Oil & Gas', count: 32, lastSent: '2024-05-10', color: '#1565C0' },
  { industry: 'medical', label: 'Medical', count: 28, lastSent: '2024-05-08', color: '#E91E63' },
  { industry: 'pharma', label: 'Pharmaceutical', count: 24, lastSent: '2024-05-05', color: '#9C27B0' },
  { industry: 'agricultural', label: 'Agricultural', count: 18, lastSent: '2024-04-28', color: '#2E7D32' },
  { industry: 'manufacturing', label: 'Manufacturing', count: 35, lastSent: '2024-05-12', color: '#E65100' },
  { industry: 'mining', label: 'Mining & Construction', count: 12, lastSent: '2024-04-20', color: '#607D8B' },
  { industry: 'others', label: 'Others', count: 7, lastSent: '2024-04-15', color: '#795548' },
];

export default function Newsletter() {
  const navigate = useReactNavigate();

  const totalSubs = 156;

  return (
    <PageWrapper title="Newsletter Broadcasts">
      <div style={{ 
        background: 'var(--color-surface)', 
        borderRadius: '12px', 
        border: '1px solid rgba(0,0,0,0.04)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        overflow: 'hidden',
        marginBottom: 24
      }}>
        {}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '20px 24px', 
          borderBottom: '1px solid rgba(0,0,0,0.04)',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, marginBottom: 4 }}>
              Subscriber Segments
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
              Manage your customer mailing lists and broadcast premium email campaigns.
            </p>
          </div>
          <button 
            className="btn btn-primary" 
            onClick={() => navigate('/admin/newsletter/compose')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Send size={16} />
            Compose Broadcast
          </button>
        </div>

        {/* Table */}
        {/* Responsive Flex List */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Header Row - hidden on very small screens implicitly by layout or just kept as a reference */}
          <div style={{ 
            display: 'flex', 
            padding: '12px 24px', 
            background: 'var(--color-surface)', 
            borderBottom: '1px solid rgba(0,0,0,0.04)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}>
            <div style={{ flex: '1 1 200px' }}>Audience Segment</div>
            <div style={{ flex: '1 1 200px' }}>Distribution</div>
            <div style={{ flex: '0 0 auto', width: 120 }}>Last Sent</div>
          </div>

          {segments.map((segment) => {
            const ratio = (segment.count / totalSubs) * 100;
            return (
              <div 
                key={segment.industry} 
                onClick={() => navigate(`/admin/newsletter/compose?segment=${segment.industry}`)}
                style={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  alignItems: 'center', 
                  padding: '16px 24px', 
                  borderBottom: '1px solid rgba(0,0,0,0.04)',
                  gap: 16,
                  cursor: 'pointer',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, #f8f9fa)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {/* Segment Name & Pill */}
                <div style={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{segment.label}</span>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-badge)',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)',
                    fontSize: '11px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}>
                    {segment.count} subs
                  </span>
                </div>

                {/* Progress Bar */}
                <div style={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: '16px', minWidth: 200 }}>
                  <div style={{ flex: 1, height: '6px', background: 'var(--color-border)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${ratio}%`, height: '100%', background: segment.color, borderRadius: '999px' }} />
                  </div>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', width: '32px', textAlign: 'right', fontWeight: 600 }}>
                    {Math.round(ratio)}%
                  </span>
                </div>

                {/* Last Sent */}
                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', minWidth: 120 }}>
                  <MailOpen size={15} style={{ opacity: 0.7 }} />
                  <span>Sent {segment.lastSent}</span>
                  <ChevronRight size={16} style={{ marginLeft: 8, opacity: 0.5 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PageWrapper>
  );
}
