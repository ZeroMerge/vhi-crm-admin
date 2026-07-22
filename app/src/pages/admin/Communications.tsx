import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { formatDate } from '@/utils/formatDate';
import { communicationService } from '@/services/communication.service';
import { useAuthStore } from '@/store/authStore';
import type { Communication } from '@/types';
import { ChatInterface, type Conversation, type Message } from '@/components/ui/ChatInterface';

export default function Communications() {
  const admin = useAuthStore((s) => s.admin);
  const isSupportStaff = admin?.activeRole === 'support_staff';

  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const filter = searchParams.get('filter') || '';
  const industry = searchParams.get('industry') || '';
  const sortBy = searchParams.get('sortBy') || 'newest';
  const selectedCustomerId = searchParams.get('selected') || undefined;

  const [threads, setThreads] = useState<any[]>([]);
  const [messages, setMessages] = useState<Communication[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  // Fetch threads
  useEffect(() => {
    let active = true;
    const fetchThreads = async () => {
      try {
        const data = await communicationService.getAll({
          search,
          filter,
          sortBy,
          industry,
        }) as any[];
        if (active) {
          setThreads(data);
        }
      } catch (err) {
        console.error('Failed to fetch threads:', err);
      }
    };
    fetchThreads();
    return () => {
      active = false;
    };
  }, [search, filter, sortBy, industry]);

  // Fetch messages when a thread is selected
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

  const handleSelectConversation = (customerId: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('selected', customerId);
    setSearchParams(newParams);
  };

  const handleSendMessage = async (content: string) => {
    if (isSupportStaff || !selectedCustomerId || !content.trim()) return;
    setSending(true);
    try {
      const sentMsg = await communicationService.send({
        customerId: selectedCustomerId,
        subject: 'New Message', // Adriel's ChatInterface doesn't have a separate subject field
        body: content,
      });
      setMessages((prev) => [...prev, sentMsg]);
      
      // Refresh threads to update last message
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

  // Map to ChatInterface types
  const chatConversations: Conversation[] = threads.map((t) => ({
    id: t.id,
    title: `${t.firstname} ${t.lastname}`,
    lastMessage: t.last_message || '(No messages)',
    timestamp: '', // Thread list doesn't return timestamp directly right now
    unread: parseInt(t.unread_count || '0') > 0,
  }));

  const chatMessages: Message[] = messages.map((m) => {
    const isFromAdmin = m.sentBy && m.sentBy.startsWith('admin');
    return {
      id: m.id,
      role: isFromAdmin ? 'assistant' : 'user',
      content: m.subject && m.subject !== 'New Message' ? `**${m.subject}**\n\n${m.body}` : m.body,
      timestamp: formatDate(m.createdAt),
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
          loading={loadingMessages || sending}
        />
      </div>
    </PageWrapper>
  );
}