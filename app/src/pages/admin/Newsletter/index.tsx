import { useState } from 'react';
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
  const [hoveredIdx, setHoveredIdx] = useState<string | null>(null);

  const totalSubs = 156;

  return (
    <PageWrapper title="Newsletter Broadcasts">
      {/* Top action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' }}>
          Manage your customer mailing lists and broadcast premium email campaigns.
        </p>
        <button 
          className="btn btn-primary" 
          onClick={() => navigate('/admin/newsletter/compose')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px' }}
        >
          <Send size={16} />
          Compose Broadcast
        </button>
      </div>

      {/* Notion-Style List Header */}
      <div 
        style={{ 
          display: 'grid', 
          gridTemplateColumns: '260px 1fr 180px 50px', 
          padding: '12px 16px',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
          marginBottom: '8px'
        }}
      >
        <span>Audience Segment</span>
        <span>Mailing Distribution Ratio</span>
        <span>Last Campaign</span>
        <span style={{ textAlign: 'right' }}>Actions</span>
      </div>

      {/* Segment list container - generous spacing instead of 1px lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {segments.map((segment) => {
          const isHovered = hoveredIdx === segment.industry;
          const ratio = (segment.count / totalSubs) * 100;
          
          return (
            <div
              key={segment.industry}
              onClick={() => navigate(`/admin/newsletter/compose?segment=${segment.industry}`)}
              onMouseEnter={() => setHoveredIdx(segment.industry)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: '260px 1fr 180px 50px',
                alignItems: 'center',
                padding: '18px 16px',
                background: isHovered ? 'var(--color-surface)' : 'rgba(255, 255, 255, 0.4)',
                borderRadius: 'var(--radius-card)', /* 12px */
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isHovered ? '0 4px 12px rgba(0, 0, 0, 0.02)' : 'none',
                transform: isHovered ? 'translateY(-1px)' : 'none'
              }}
            >
              {/* Segment Name & Sleek Tag */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ 
                  fontWeight: 600, 
                  fontSize: 'var(--font-size-base)', 
                  color: isHovered ? 'var(--color-primary)' : 'var(--color-text-primary)' 
                }}>
                  {segment.label}
                </span>
                <span style={{
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-badge)',
                  background: isHovered ? 'var(--color-primary-light)' : 'var(--color-border)',
                  color: isHovered ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  fontSize: '11px',
                  fontWeight: 600
                }}>
                  {segment.count} subs
                </span>
              </div>

              {/* Distribution ratio mini chart */}
              <div style={{ paddingRight: '48px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ 
                  flex: 1, 
                  height: '6px', 
                  background: 'var(--color-border)', 
                  borderRadius: '999px',
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  <div style={{
                    width: `${ratio}%`,
                    height: '100%',
                    background: segment.color,
                    borderRadius: '999px',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                <span style={{ 
                  fontSize: 'var(--font-size-xs)', 
                  color: 'var(--color-text-secondary)', 
                  width: '32px',
                  textAlign: 'right',
                  fontWeight: 500
                }}>
                  {Math.round(ratio)}%
                </span>
              </div>

              {/* Last sent date */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                <MailOpen size={15} style={{ opacity: 0.7 }} />
                <span>Sent {segment.lastSent}</span>
              </div>

              {/* Action arrow */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', color: isHovered ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                <ChevronRight size={18} style={{ transform: isHovered ? 'translateX(2px)' : 'none', transition: 'transform 0.2s' }} />
              </div>
            </div>
          );
        })}
      </div>
    </PageWrapper>
  );
}
