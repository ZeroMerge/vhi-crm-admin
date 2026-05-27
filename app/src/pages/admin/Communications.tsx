import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Send, ChevronLeft, AlertTriangle } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { formatDate } from '@/utils/formatDate';
import { communicationService } from '@/services/communication.service';
import { Avatar } from '@/components/shared/Avatar';
import { useAuthStore } from '@/store/authStore';
import type { Communication } from '@/types';

const industries = [
  { value: '', label: 'All Industries' },
  { value: 'oil_gas', label: 'Oil & Gas' },
  { value: 'medical', label: 'Medical' },
  { value: 'pharma', label: 'Pharmaceutical' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'mining', label: 'Mining' },
  { value: 'others', label: 'Others' },
];

export default function Communications() {
  const admin = useAuthStore((s) => s.admin);
  const isSupportStaff = admin?.activeRole === 'support_staff';

  const [searchParams, setSearchParams] = useSearchParams();

  // Read filters from URL params
  const search = searchParams.get('search') || '';
  const filter = searchParams.get('filter') || '';
  const industry = searchParams.get('industry') || '';
  const sortBy = searchParams.get('sortBy') || 'newest';
  const selectedCustomerId = searchParams.get('selected') || '';

  const [threads, setThreads] = useState<any[]>([]);
  const [messages, setMessages] = useState<Communication[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Fetch threads with filters
  useEffect(() => {
    let active = true;
    const fetchThreads = async () => {
      setLoadingThreads(true);
      try {
        const data = await communicationService.getAll({
          search,
          filter,
          sortBy,
          industry,
        }) as any[];
        if (active) {
          setThreads(data);
          
          // Auto-select first thread if nothing is selected yet
          if (data.length > 0 && !selectedCustomerId) {
            const newParams = new URLSearchParams(searchParams);
            newParams.set('selected', data[0].id);
            setSearchParams(newParams);
          }
        }
      } catch (err) {
        console.error('Failed to fetch threads:', err);
      } finally {
        if (active) setLoadingThreads(false);
      }
    };
    fetchThreads();
    return () => {
      active = false;
    };
  }, [search, filter, sortBy, industry, selectedCustomerId]);

  // Fetch messages in thread
  useEffect(() => {
    if (!selectedCustomerId) {
      setMessages([]);
      return;
    }
    let active = true;
    const fetchMessages = async () => {
      setLoadingMessages(true);
      try {
        const data = await communicationService.getThread(selectedCustomerId);
        if (active) {
          setMessages(data);
        }
      } catch (err) {
        console.error('Failed to fetch thread messages:', err);
      } finally {
        if (active) setLoadingMessages(false);
      }
    };
    fetchMessages();
    return () => {
      active = false;
    };
  }, [selectedCustomerId]);

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  };

  const handleSelectCustomer = (customerId: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('selected', customerId);
    setSearchParams(newParams);
    setShowCompose(false);
  };

  const handleSendMessage = async () => {
    if (isSupportStaff || !selectedCustomerId || !subject || !body) return;
    setSending(true);
    try {
      const sentMsg = await communicationService.send({
        customerId: selectedCustomerId,
        subject,
        body,
      });
      setMessages((prev) => [...prev, sentMsg]);
      setSubject('');
      setBody('');
      setShowCompose(false);
      
      // Refresh threads to update last message/timestamp
      const data = await communicationService.getAll({
        search,
        filter,
        sortBy,
        industry,
      }) as any[];
      setThreads(data);
    } catch (err) {
      console.error('Failed to send message:', err);
      alert('Error sending message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const selectedCustomer = threads.find((t) => t.id === selectedCustomerId);

  return (
    <PageWrapper title="Communications">
      <div className="communications-grid">
        {/* Left Panel - Customer List */}
        <div style={{ borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="search-input-wrapper" style={{ maxWidth: '100%' }}>
              <Search size={16} className="search-icon" />
              <input
                className="input"
                placeholder="Search threads..."
                value={search}
                onChange={(e) => updateFilter('search', e.target.value)}
                style={{ paddingLeft: 40, fontSize: 'var(--font-size-sm)' }}
              />
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select
                className="select"
                value={industry}
                onChange={(e) => updateFilter('industry', e.target.value)}
                style={{ fontSize: 'var(--font-size-xs)', height: 32, padding: '0 8px' }}
              >
                {industries.map((ind) => (
                  <option key={ind.value} value={ind.value}>
                    {ind.label}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={filter}
                onChange={(e) => updateFilter('filter', e.target.value)}
                style={{ fontSize: 'var(--font-size-xs)', height: 32, padding: '0 8px' }}
              >
                <option value="">All Threads</option>
                <option value="unread">Unread Only</option>
              </select>
            </div>
            
            <select
              className="select"
              value={sortBy}
              onChange={(e) => updateFilter('sortBy', e.target.value)}
              style={{ fontSize: 'var(--font-size-xs)', height: 32, padding: '0 8px' }}
            >
              <option value="newest">Sort: Newest first</option>
              <option value="oldest">Sort: Oldest first</option>
            </select>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingThreads ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                Loading conversations...
              </div>
            ) : threads.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                No conversations found
              </div>
            ) : (
              threads.map((thread) => {
                const uc = parseInt(thread.unread_count || '0');
                const isSelected = selectedCustomerId === thread.id;
                return (
                  <button
                    key={thread.id}
                    onClick={() => handleSelectCustomer(thread.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: '100%',
                      padding: '12px 16px',
                      border: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      background: isSelected ? 'var(--color-primary-light)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-family)',
                    }}
                  >
                    <Avatar name={`${thread.firstname} ${thread.lastname}`} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: isSelected || uc > 0 ? 600 : 500, fontSize: 'var(--font-size-sm)', color: isSelected ? 'var(--color-primary)' : 'var(--color-text)' }} className="truncate">
                          {thread.firstname} {thread.lastname}
                        </span>
                        {uc > 0 && (
                          <span style={{ background: 'var(--color-accent-pink)', color: 'white', fontSize: 10, fontWeight: 600, width: 18, height: 18, borderRadius: 'var(--border-radius-pill)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {uc}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: uc > 0 ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: uc > 0 ? 500 : 400 }} className="truncate">
                        {thread.last_message || '(No messages)'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Panel - Message Thread */}
        <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--color-page-bg)' }}>
          {isSupportStaff && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
                padding: '8px 16px',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 500,
                borderBottom: '1px solid var(--color-border)'
              }}
            >
              <AlertTriangle size={14} />
              <span>You are in Read-Only Support Staff mode. You cannot send new messages.</span>
            </div>
          )}

          {selectedCustomer && !showCompose && (
            <>
              {/* Thread Header */}
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar name={`${selectedCustomer.firstname} ${selectedCustomer.lastname}`} size="md" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{selectedCustomer.firstname} {selectedCustomer.lastname}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                      {selectedCustomer.industry ? selectedCustomer.industry.replace(/_/g, ' ') : 'General'}
                    </div>
                  </div>
                </div>
                {!isSupportStaff && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowCompose(true)}>
                    <Send size={14} />
                    New Message
                  </button>
                )}
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {loadingMessages ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    Loading message history...
                  </div>
                ) : messages.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    No messages in this conversation.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isFromAdmin = msg.sentBy && msg.sentBy.startsWith('admin');
                    return (
                      <div key={msg.id} style={{ maxWidth: '80%', alignSelf: isFromAdmin ? 'flex-end' : 'flex-start' }}>
                        <div
                          style={{
                            padding: 16,
                            background: isFromAdmin ? 'var(--color-primary-light)' : 'var(--color-surface)',
                            borderRadius: 'var(--border-radius-card)',
                            border: `1px solid ${isFromAdmin ? 'var(--color-primary-light)' : 'var(--color-border)'}`,
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 'var(--font-size-sm)', color: isFromAdmin ? 'var(--color-primary)' : 'var(--color-text)' }}>
                            {msg.subject}
                          </div>
                          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                            {msg.body}
                          </div>
                        </div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4, paddingLeft: 8, textAlign: isFromAdmin ? 'right' : 'left' }}>
                          {formatDate(msg.createdAt)} {isFromAdmin ? '• Sent by VHI Admin' : ''}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {showCompose && selectedCustomer && (
            <>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-surface)' }}>
                <button className="btn btn-icon btn-ghost" onClick={() => setShowCompose(false)}>
                  <ChevronLeft size={18} />
                </button>
                <span style={{ fontWeight: 600 }}>New Message to {selectedCustomer.firstname} {selectedCustomer.lastname}</span>
              </div>
              <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--color-surface)' }}>
                <div className="form-group">
                  <label className="form-label">Subject</label>
                  <input
                    className="input"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Enter message subject..."
                    disabled={sending}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Message</label>
                  <textarea
                    className="input"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Type your message here..."
                    disabled={sending}
                    style={{ width: '100%', height: 'calc(100% - 30px)', borderRadius: 'var(--border-radius-card)', resize: 'none', minHeight: 200 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, alignSelf: 'flex-end' }}>
                  <button className="btn btn-outline" onClick={() => setShowCompose(false)} disabled={sending}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSendMessage}
                    disabled={sending || !subject.trim() || !body.trim()}
                  >
                    <Send size={16} />
                    {sending ? 'Sending...' : 'Send Message'}
                  </button>
                </div>
              </div>
            </>
          )}

          {!selectedCustomerId && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--color-text-muted)' }}>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 500 }}>No Thread Selected</div>
              <div style={{ fontSize: 'var(--font-size-sm)' }}>Select a conversation from the sidebar to view messages</div>
            </div>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}
