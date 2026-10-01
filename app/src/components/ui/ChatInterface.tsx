import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Send, Plus, MessageSquare, Trash2, CheckCheck, Clock, ChevronLeft } from "lucide-react";
import './ChatInterface.css';

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  status?: "sending" | "sent";
  subject?: string;
}

export interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: string;
  unread?: boolean;
}

export interface ChatInterfaceProps {
  conversations: Conversation[];
  messages: Message[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  onSendMessage: (content: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  currentUserId?: string;
  loading?: boolean;
}

export function ChatInterface(props: ChatInterfaceProps) {
  const {
    conversations,
    messages,
    selectedConversationId,
    onSelectConversation,
    onSendMessage,
    onNewConversation,
    onDeleteConversation,
    loading = false,
  } = props;
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileViewOpen, setIsMobileViewOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesCount = useRef(messages.length);

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    
    // Play sound notification if new incoming message
    if (messages.length > prevMessagesCount.current) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'user') {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => console.log('Audio play failed:', e));
      }
    }
    prevMessagesCount.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (selectedConversationId) {
      setIsMobileViewOpen(true);
    }
  }, [selectedConversationId]);

  const selectedConv = conversations.find((c) => c.id === selectedConversationId);

  const handleSelectConversationMobile = (id: string) => {
    onSelectConversation(id);
    setIsMobileViewOpen(true);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`chat-container ${isMobileViewOpen ? 'mobile-view-open' : ''}`}>
      {/* Left Panel — Conversation History */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <Button
            variant="default"
            style={{ width: '100%', justifyContent: 'flex-start', gap: '0.5rem' }}
            onClick={onNewConversation}
          >
            <Plus style={{ height: '1rem', width: '1rem' }} />
            New conversation
          </Button>
        </div>

        <div className="chat-sidebar-search">
          <div className="chat-search-input-wrapper">
            <Search className="chat-search-icon" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '2.25rem', height: '2.25rem', fontSize: 'var(--font-size-sm)' }}
            />
          </div>
        </div>

        <div className="chat-sidebar-list">
          {filteredConversations.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '6rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', padding: '0 0.75rem', textAlign: 'center' }}>
              No conversations found
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                className={`chat-sidebar-item ${selectedConversationId === conv.id ? 'chat-sidebar-item-active' : ''}`}
                onClick={() => handleSelectConversationMobile(conv.id)}
              >
                <MessageSquare style={{ marginTop: '0.125rem', height: '1rem', width: '1rem', flexShrink: 0, color: 'var(--color-text-muted)' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--font-size-sm)', fontWeight: conv.unread ? 600 : 500 }}>
                      {conv.title}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{conv.timestamp}</span>
                  </div>
                  <p style={{ marginTop: '0.125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{conv.lastMessage}</p>
                </div>
                {onDeleteConversation && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                    className="chat-sidebar-item-delete"
                  >
                    <Trash2 style={{ height: '0.875rem', width: '0.875rem' }} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel — Chat */}
      <div className="chat-main">
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="chat-main-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button 
                  className="chat-mobile-back" 
                  onClick={() => setIsMobileViewOpen(false)}
                >
                  <ChevronLeft style={{ height: '1.25rem', width: '1.25rem' }} />
                </button>
                <h2 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>{selectedConv.title}</h2>
              </div>
            </div>

            {/* Messages */}
            <div className="chat-main-messages">
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                  Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                  Start a conversation
                </div>
              ) : (
                messages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`chat-message-row ${isUser ? 'user' : 'assistant'}`}
                    >
                      <div className={`chat-message-bubble ${msg.role}`}>
                        {msg.subject && <p style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>{msg.subject}</p>}
                        <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                        <div className={`chat-message-time ${msg.role}`}>
                          {msg.timestamp}
                          {!isUser && msg.status === 'sending' && (
                            <Clock style={{ height: '0.75rem', width: '0.75rem', marginLeft: '0.25rem', opacity: 0.7 }} />
                          )}
                          {!isUser && msg.status === 'sent' && (
                            <CheckCheck style={{ height: '0.875rem', width: '0.875rem', marginLeft: '0.25rem', color: '#60a5fa' }} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="chat-main-input-area">
              <div className="chat-main-input-wrapper">
                <Input
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  style={{ height: '2.5rem', flex: 1 }}
                />
                <Button
                  style={{ height: '2.5rem', width: '2.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: 0 }}
                  onClick={handleSend}
                  disabled={!input.trim()}
                >
                  <Send style={{ height: '1.25rem', width: '1.25rem' }} />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="chat-empty-state">
            <div>
              <MessageSquare style={{ margin: '0 auto', height: '3rem', width: '3rem', color: 'var(--color-text-muted)', opacity: 0.5 }} />
              <p style={{ marginTop: '0.5rem', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Select a conversation or start a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
