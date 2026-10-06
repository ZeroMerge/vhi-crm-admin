import { useEffect, useState } from 'react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Star } from 'lucide-react';
import { formatDate } from '@/utils/formatDate';
import { feedbackService, type FeedbackRow } from '@/services/feedback.service';
import { useIsMobile } from '@/hooks/use-mobile';

export default function Feedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    let active = true;
    const loadFeedback = async () => {
      setLoading(true);
      try {
        const data = await feedbackService.list();
        if (active) setRows(data);
      } catch (err) {
        console.error('Failed to load feedback:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadFeedback();
    return () => {
      active = false;
    };
  }, []);

  return (
    <PageWrapper title="Feedback">
      <div className="card" style={{ marginBottom: 20, padding: isMobile ? '16px' : '24px' }}>
        <h3 className="card-title" style={{ marginBottom: 6, fontSize: isMobile ? 'var(--font-size-md)' : undefined }}>Customer Feedback</h3>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>Review survey responses and service notes submitted by customers.</p>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', borderRadius: 'var(--border-radius-card)', border: '1.5px solid var(--color-border)' }}>Loading feedback...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', borderRadius: 'var(--border-radius-card)', border: '1.5px solid var(--color-border)' }}>No feedback available.</div>
      ) : isMobile ? (
        /* Mobile: Native review cards — no horizontal squeezing */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--border-radius-card)',
                border: '1.5px solid var(--color-border)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              {/* Header: Customer info on left, Rating badge on right */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                    {row.firstname ? `${row.firstname} ${row.lastname || ''}`.trim() : row.customer_id}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', wordBreak: 'break-all', marginTop: 2 }}>
                    {row.email}
                  </div>
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-badge)',
                  fontWeight: 600,
                  fontSize: 'var(--font-size-xs)',
                  flexShrink: 0
                }}>
                  <Star size={12} color="var(--color-primary)" fill="currentColor" />
                  <span>{row.rating}/5</span>
                </div>
              </div>

              {/* Message body with readable line height */}
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-primary)',
                lineHeight: 1.5,
                margin: 0,
                wordBreak: 'break-word',
                background: 'var(--color-page-bg)',
                padding: '10px 12px',
                borderRadius: 'var(--border-radius-sm)',
              }}>
                "{row.message || 'No message provided'}"
              </p>

              {/* Footer: Date */}
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                {formatDate(row.created_at)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Desktop: Standard full-width table */
        <div className="vhi-table-container">
          <table className="vhi-table">
            <thead>
              <tr>
                <th style={{ width: '220px' }}>Customer</th>
                <th style={{ width: '120px' }}>Rating</th>
                <th>Message</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 500 }}>
                    {row.firstname ? `${row.firstname} ${row.lastname || ''}`.trim() : row.customer_id}
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{row.email}</div>
                  </td>
                  <td>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '3px 8px', borderRadius: 'var(--radius-badge)', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                      <Star size={13} color="var(--color-primary)" fill="currentColor" />
                      <span>{row.rating}/5</span>
                    </div>
                  </td>
                  <td style={{ maxWidth: 520, lineHeight: 1.5 }}>{row.message || 'No message provided'}</td>
                  <td style={{ color: 'var(--color-text-muted)', textAlign: 'right' }}>{formatDate(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageWrapper>
  );
}