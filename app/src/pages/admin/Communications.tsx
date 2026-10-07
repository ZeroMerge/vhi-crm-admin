import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { formatChatTime } from '@/utils/formatChatTime';
import { communicationService } from '@/services/communication.service';
import { useAuthStore } from '@/store/authStore';
import type { Communication } from '@/types';
import { ChatInterface, type Conversation, type Message } from '@/components/ui/ChatInterface';
import { NotificationStreamContext, useInvalidateNotifications, useStreamEvents } from '@/hooks/useNotifications';
import { BATCH_MS, createBatcher, idsToMarkRead, mergeMessages, unseenIds, type Batcher } from '@/lib/threadSync';

// While the stream is down, the page polls at this interval (it never polls while connected).
const FALLBACK_POLL_MS = 15_000;
// Reading is reported shortly after messages are displayed, so a burst of arrivals is one request.
const READ_REPORT_DELAY_MS = 300;
// Several pushes in a row refresh the thread list once.
const LIST_REFRESH_DEBOUNCE_MS = 300;

const isTabVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const isTemp = (m: Communication) => m.id.startsWith('temp-');

export default function Communications() {
  const admin = useAuthStore((s) => s.admin);
  const isSupportStaff = admin?.activeRole === 'support_staff';
  const streaming = useContext(NotificationStreamContext);

  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const filter = searchParams.get('filter') || '';
  const industry = searchParams.get('industry') || '';
  const sortBy = searchParams.get('sortBy') || 'newest';
  const selectedCustomerId = searchParams.get('selected') || undefined;

  const [threads, setThreads] = useState<any[]>([]);
  const [messages, setMessages] = useState<Communication[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const invalidateNotifications = useInvalidateNotifications();

  // Latest values for callbacks that outlive a render (stream handlers, timers).
  const latest = useRef({ search, filter, sortBy, industry, selectedCustomerId, messages });
  useEffect(() => {
    latest.current = { search, filter, sortBy, industry, selectedCustomerId, messages };
  });

  // ---- thread list (unread counts, last message, ordering)
  const refreshThreads = useCallback(async () => {
    const { search, filter, sortBy, industry } = latest.current;
    try {
      setThreads((await communicationService.getAll({ search, filter, sortBy, industry })) as any[]);
    } catch (err) {
      console.error('Failed to fetch threads:', err);
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
  }, [search, filter, sortBy, industry, refreshThreads]);

  // ---- the open thread
  // Full reload (read-only: the server never marks on this GET). Optimistic placeholders still in flight are kept.
  const reloadOpenThread = useCallback(async () => {
    const customerId = latest.current.selectedCustomerId;
    if (!customerId) return;
    try {
      const data = await communicationService.getThread(customerId);
      if (latest.current.selectedCustomerId !== customerId) return;
      setMessages((previous) => mergeMessages(previous.filter(isTemp), data));
    } catch (err) {
      console.error('Failed to fetch thread messages:', err);
    }
  }, []);

  useEffect(() => {
    if (!selectedCustomerId) return; // nothing selected: the page shows no messages (see `shownMessages`)
    let active = true;
    const load = async () => {
      setLoadingMessages(true);
      try {
        const data = await communicationService.getThread(selectedCustomerId);
        if (active) setMessages(data);
      } catch (err) {
        console.error('Failed to fetch thread messages:', err);
      } finally {
        if (active) setLoadingMessages(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [selectedCustomerId]);

  // ---- live updates: the one notification stream (no channel subscription of our own)
  // Announced message ids are collected for ~150 ms, then fetched together, skipping ids the thread already has.
  const batcher = useRef<Batcher | null>(null);
  useEffect(() => {
    const b = createBatcher((ids) => {
      const customerId = latest.current.selectedCustomerId;
      if (!customerId) return;
      const wanted = unseenIds(ids, new Set(latest.current.messages.map((m) => m.id)));
      if (wanted.length === 0) return;
      communicationService
        .getThreadMessages(customerId, wanted)
        .then((fresh) => {
          if (latest.current.selectedCustomerId !== customerId) return; // the user moved on; that thread was loaded in full
          setMessages((previous) => mergeMessages(previous, fresh.filter((m) => m.customerId === customerId)));
        })
        .catch((err) => {
          console.error('Failed to fetch new messages:', err);
          void reloadOpenThread();
        });
    }, BATCH_MS);
    batcher.current = b;
    return () => {
      b.cancel();
      batcher.current = null;
    };
  }, [reloadOpenThread]);
  useEffect(() => {
    // Switching threads drops ids announced for the previous one (the new thread is loaded in full).
    batcher.current?.cancel();
  }, [selectedCustomerId]);

  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleThreadsRefresh = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => {
      listTimer.current = null;
      void refreshThreads();
    }, LIST_REFRESH_DEBOUNCE_MS);
  }, [refreshThreads]);
  useEffect(
    () => () => {
      if (listTimer.current) clearTimeout(listTimer.current);
    },
    []
  );

  useStreamEvents((event) => {
    if (event.type === 'ready') {
      // Connect or reconnect: REST is the catch-up for anything committed while the stream was down.
      void refreshThreads();
      void reloadOpenThread();
    } else if (event.type === 'message_created') {
      if (event.customerId === latest.current.selectedCustomerId) batcher.current?.add(event.messageId);
      scheduleThreadsRefresh();
    } else if (event.type === 'thread_read') {
      scheduleThreadsRefresh();
    }
  });

  // Poll only while the stream is disconnected.
  useEffect(() => {
    if (streaming) return;
    const timer = setInterval(() => {
      void refreshThreads();
      void reloadOpenThread();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [streaming, refreshThreads, reloadOpenThread]);

  // ---- read state: report the customer messages that were actually displayed, only while this tab is visible
  const reported = useRef(new Set<string>());
  const [visible, setVisible] = useState(isTabVisible);
  useEffect(() => {
    const onChange = () => setVisible(isTabVisible());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  useEffect(() => {
    if (!visible || !selectedCustomerId || loadingMessages) return;
    const ids = idsToMarkRead(messages, 'admin', reported.current);
    if (ids.length === 0) return;
    const timer = setTimeout(() => {
      ids.forEach((id) => reported.current.add(id));
      communicationService
        .markThreadRead(selectedCustomerId, ids)
        .then(() => {
          void invalidateNotifications();
          void refreshThreads();
        })
        .catch((err) => {
          console.error('Failed to mark messages read:', err);
          ids.forEach((id) => reported.current.delete(id)); // try again on the next change
        });
    }, READ_REPORT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [messages, selectedCustomerId, visible, loadingMessages, invalidateNotifications, refreshThreads]);

  const handleSelectConversation = (customerId: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('selected', customerId);
    setSearchParams(newParams);
  };

  const handleSendMessage = async (content: string) => {
    if (isSupportStaff || !selectedCustomerId || !content.trim()) return;

    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Communication = {
      id: tempId,
      customerId: selectedCustomerId,
      subject: 'New Message',
      body: content,
      isRead: true,
      createdAt: new Date().toISOString(),
      senderType: 'admin',
      sentByCustomer: false,
      sentBy: admin?.id || '',
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const sentMsg = await communicationService.send({
        customerId: selectedCustomerId,
        subject: 'New Message',
        body: content,
      });
      // Replace the optimistic message with the server's. The push for this same message may already have merged it: no duplicate.
      setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== tempId), [sentMsg]));
      void refreshThreads();
    } catch (err) {
      console.error('Failed to send message:', err);
      // Revert optimistic update on failure
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      alert('Error sending message. Please try again.');
    }
  };

  // Map to ChatInterface types
  const chatConversations: Conversation[] = threads.map((t) => ({
    id: t.id,
    title: `${t.firstname} ${t.lastname}`,
    lastMessage: t.last_message || '(No messages)',
    timestamp: t.last_message_at ? formatChatTime(t.last_message_at) : '',
    unread: parseInt(t.unread_count || '0') > 0,
  }));

  const shownMessages = selectedCustomerId ? messages : [];
  const chatMessages: Message[] = shownMessages.map((m) => {
    const isFromAdmin = m.senderType === 'admin' || (!m.senderType && Boolean(m.sentBy));
    return {
      id: m.id,
      role: isFromAdmin ? 'user' : 'assistant',
      subject: m.subject && m.subject !== 'New Message' ? m.subject : undefined,
      content: m.body,
      timestamp: formatChatTime(m.createdAt),
      status: m.id.startsWith('temp-') ? 'sending' : 'sent',
    };
  });

  return (
    <PageWrapper title="Communications">
      <div style={{ height: 'calc(100vh - 140px)', marginTop: '-8px' }}>
        <ChatInterface
          conversations={chatConversations}
          messages={chatMessages}
          selectedConversationId={selectedCustomerId}
          onSelectConversation={handleSelectConversation}
          onSendMessage={handleSendMessage}
          loading={loadingMessages}
        />
      </div>
    </PageWrapper>
  );
}
