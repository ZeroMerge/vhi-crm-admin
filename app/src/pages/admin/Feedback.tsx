import { useEffect, useState } from 'react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Star } from 'lucide-react';
import { formatDate } from '@/utils/formatDate';
import { feedbackService, type FeedbackRow } from '@/services/feedback.service';

export default function Feedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

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
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 className="card-title" style={{ marginBottom: 8 }}>Customer Feedback</h3>
        <p style={{ color: 'var(--color-text-secondary)' }}>Review survey responses and service notes submitted by customers.</p>
      </div>

      <div className="vhi-table-container">
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading feedback...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>No feedback available.</div>
        ) : (
          <table className="vhi-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Rating</th>
                <th>Message</th>
                <th>Date</th>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Star size={14} color="var(--color-primary)" fill="currentColor" />
                      <span>{row.rating}/5</span>
                    </div>
                  </td>
                  <td style={{ maxWidth: 520 }}>{row.message || 'No message provided'}</td>
                  <td style={{ color: 'var(--color-text-muted)' }}>{formatDate(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageWrapper>
  );
}