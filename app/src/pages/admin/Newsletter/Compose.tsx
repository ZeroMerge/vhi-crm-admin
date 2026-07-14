import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Users } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { newsletterService } from '@/services/communication.service';
import { useNotificationStore } from '@/store/notificationStore';

const customerStatuses = [
  { value: 'all', label: 'All Customers' },
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'returning', label: 'Returning' },
  { value: 'loyal', label: 'Loyal' },
  { value: 'NULL', label: 'No Status' },
];

const industries = [
  { value: 'oil_gas', label: 'Oil & Gas' },
  { value: 'medical', label: 'Medical' },
  { value: 'pharma', label: 'Pharmaceutical' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'mining', label: 'Mining & Construction' },
  { value: 'others', label: 'Others' },
];

export default function ComposeNewsletter() {
  const navigate = useNavigate();
  const { addNotification } = useNotificationStore();
  const [selectedSegments, setSelectedSegments] = useState<string[]>(['all']);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!subject || !body) return;
    try {
      setIsSending(true);
      await newsletterService.send({
        subject,
        body,
        segments: selectedSegments,
        status: selectedStatus,
      });
      addNotification({
        id: Date.now().toString(),
        title: 'Newsletter',
        message: 'Newsletter scheduled/sent successfully',
        read: false,
        createdAt: new Date().toISOString(),
        type: 'system',
      });
      navigate('/admin/newsletter');
    } catch (err) {
      console.error('Failed to send newsletter:', err);
      addNotification({
        id: Date.now().toString(),
        title: 'Newsletter Error',
        message: 'Failed to send newsletter',
        read: false,
        createdAt: new Date().toISOString(),
        type: 'system',
      });
    } finally {
      setIsSending(false);
    }
  };

  const toggleSegment = (value: string) => {
    if (value === 'all') {
      setSelectedSegments(['all']);
      return;
    }
    setSelectedSegments((prev) => {
      const filtered = prev.filter((s) => s !== 'all');
      if (filtered.includes(value)) return filtered.filter((s) => s !== value);
      return [...filtered, value];
    });
  };

  const recipientCount = selectedSegments.includes('all') ? 156 : selectedSegments.length * 20;

  return (
    <PageWrapper title="Compose Newsletter">
      <button onClick={() => navigate('/admin/newsletter')} className="btn-back">
        <ArrowLeft size={18} />
        Back to Newsletter
      </button>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Left - Compose Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: '1 1 600px', minWidth: 0 }}>
          {/* Segments */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Select Segments</h3>
            <div className="segment-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                onClick={() => setSelectedSegments(['all'])}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-badge)',
                  border: selectedSegments.includes('all') ? '2px solid var(--color-primary)' : '2px solid var(--color-border)',
                  background: selectedSegments.includes('all') ? 'var(--color-primary-light)' : 'var(--color-page-bg)',
                  color: selectedSegments.includes('all') ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-family)',
                  fontSize: 'var(--font-size-sm)',
                  cursor: 'pointer',
                  fontWeight: selectedSegments.includes('all') ? 600 : 400,
                }}
              >
                All Subscribers
              </button>
              {industries.map((ind) => (
                <button
                  key={ind.value}
                  onClick={() => toggleSegment(ind.value)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-badge)',
                    border: selectedSegments.includes(ind.value) ? '2px solid var(--color-primary)' : '2px solid var(--color-border)',
                    background: selectedSegments.includes(ind.value) ? 'var(--color-primary-light)' : 'var(--color-page-bg)',
                    color: selectedSegments.includes(ind.value) ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontFamily: 'var(--font-family)',
                    fontSize: 'var(--font-size-sm)',
                    cursor: 'pointer',
                    fontWeight: selectedSegments.includes(ind.value) ? 600 : 400,
                  }}
                >
                  {ind.label}
                </button>
              ))}
            </div>
          </div>

          {/* Customer Status */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Filter by Customer Status</h3>
            <div className="segment-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {customerStatuses.map((stat) => (
                <button
                  key={stat.value}
                  onClick={() => setSelectedStatus(stat.value)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-badge)',
                    border: selectedStatus === stat.value ? '2px solid var(--color-primary)' : '2px solid var(--color-border)',
                    background: selectedStatus === stat.value ? 'var(--color-primary-light)' : 'var(--color-page-bg)',
                    color: selectedStatus === stat.value ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontFamily: 'var(--font-family)',
                    fontSize: 'var(--font-size-sm)',
                    cursor: 'pointer',
                    fontWeight: selectedStatus === stat.value ? 600 : 400,
                  }}
                >
                  {stat.label}
                </button>
              ))}
            </div>
          </div>

          {}
          <div className="card">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Subject</label>
              <input
                className="input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter newsletter subject..."
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {}
          <div className="card" style={{ flex: 1 }}>
            <div className="form-group" style={{ marginBottom: 0, height: '100%' }}>
              <label className="form-label">Body</label>
              <textarea
                className="input"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your newsletter content here..."
                style={{ width: '100%', minHeight: 300, borderRadius: 'var(--border-radius-md)', resize: 'vertical' }}
              />
            </div>
          </div>
        </div>

        {/* Right - Preview */}
        <div style={{ flex: '1 1 350px', minWidth: 0 }}>
          <div className="card" style={{ position: 'sticky', top: 24 }}>
            <h3 className="card-title" style={{ marginBottom: 16 }}>Preview</h3>

            {}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: 'var(--color-primary-light)', borderRadius: 'var(--border-radius-md)', marginBottom: 20 }}>
              <Users size={20} color="var(--color-primary)" />
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Recipients</div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)' }}>{recipientCount.toLocaleString()}</div>
              </div>
            </div>

            {/* Preview Content */}
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-sm)', padding: 20, background: 'var(--color-surface)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 12 }}>
                From: VHI Newsletters &lt;newsletter@valuehandlers.com&gt;
              </div>
              <div style={{ fontWeight: 600, marginBottom: 12, minHeight: 24 }}>
                {subject || '(No subject)'}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', minHeight: 100 }}>
                {body || '(No content)'}
              </div>
            </div>

            {/* Send Button */}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 20 }}
              disabled={!subject || !body || isSending}
              onClick={handleSend}
            >
              <Send size={16} />
              {isSending ? 'Sending...' : 'Send Newsletter'}
            </button>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
