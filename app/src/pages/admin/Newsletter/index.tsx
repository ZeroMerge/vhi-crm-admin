import { useState, useEffect, useMemo } from 'react';
import { useNavigate as useReactNavigate } from 'react-router-dom';
import { Send, ChevronRight, MailOpen, AlertCircle } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { newsletterService } from '@/services/communication.service';
import { formatDate } from '@/utils/formatDate';

interface Segment {
  industry: string;
  label: string;
  count: number;
  lastSent: string;
  color: string;
}

const INDUSTRY_CONFIG: Record<string, { label: string; color: string }> = {
  oil_gas: { label: 'Oil & Gas', color: '#1565C0' },
  medical: { label: 'Medical', color: '#E91E63' },
  pharma: { label: 'Pharmaceutical', color: '#9C27B0' },
  agricultural: { label: 'Agricultural', color: '#2E7D32' },
  manufacturing: { label: 'Manufacturing', color: '#E65100' },
  mining: { label: 'Mining & Construction', color: '#607D8B' },
  fmcg: { label: 'FMCG', color: '#4CAF50' },
  ecommerce: { label: 'E-commerce', color: '#FF9800' },
  others: { label: 'Others', color: '#795548' },
};

export default function Newsletter() {
  const navigate = useReactNavigate();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; subject: string; segment: string; recipientCount: number; sentAt: string }[]>([]);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [segmentsRes, historyRes] = await Promise.all([
          newsletterService.getSegments(),
          newsletterService.getHistory()
        ]);
        
        if (active) {
          // Calculate history map to find lastSent per industry
          const lastSentMap = new Map<string, string>();
          historyRes.forEach(h => {
            const hSegments = h.segment.split(',');
            hSegments.forEach(s => {
              if (s === 'all') {
                // 'all' counts for everyone
                Object.keys(INDUSTRY_CONFIG).forEach(ind => {
                  const existing = lastSentMap.get(ind);
                  if (!existing || new Date(h.sentAt) > new Date(existing)) {
                    lastSentMap.set(ind, h.sentAt);
                  }
                });
                const existingAll = lastSentMap.get('all');
                if (!existingAll || new Date(h.sentAt) > new Date(existingAll)) {
                  lastSentMap.set('all', h.sentAt);
                }
              } else {
                const existing = lastSentMap.get(s);
                if (!existing || new Date(h.sentAt) > new Date(existing)) {
                  lastSentMap.set(s, h.sentAt);
                }
              }
            });
          });

          // Process segments
          let allCount = 0;
          const mappedSegments = segmentsRes.map(s => {
            const count = Number(s.count) || 0;
            allCount += count;
            const indKey = s.industry || 'others';
            const config = INDUSTRY_CONFIG[indKey] || { label: s.industry || 'Unknown', color: '#795548' };
            const lastSentDate = lastSentMap.get(indKey);
            return {
              industry: indKey,
              label: config.label,
              count,
              lastSent: lastSentDate ? formatDate(lastSentDate).split(',')[0] : 'Never',
              color: config.color
            };
          });

          // Add 'All Subscribers' segment at the top
          const allLastSentDate = lastSentMap.get('all');
          const allSegment: Segment = {
            industry: 'all',
            label: 'All Subscribers',
            count: allCount,
            lastSent: allLastSentDate ? formatDate(allLastSentDate).split(',')[0] : 'Never',
            color: 'var(--color-primary)'
          };

          setSegments([allSegment, ...mappedSegments.filter(s => s.count > 0)]);
          setHistory(historyRes);
        }
      } catch (err) {
        if (active) setError('Failed to load audience segments');
      } finally {
        if (active) setLoading(false);
      }
    };
    
    fetchData();
    return () => { active = false; };
  }, []);

  const totalSubs = useMemo(() => segments.find(s => s.industry === 'all')?.count || 1, [segments]);

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

        {/* Table / List */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 200 }}>
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

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              Loading audience data...
            </div>
          ) : error ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-danger)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <AlertCircle size={32} />
              {error}
            </div>
          ) : segments.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              No subscribers found in database.
            </div>
          ) : (
            segments.map((segment) => {
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
            })
          )}
        </div>
      </div>
    </PageWrapper>
  );
}
