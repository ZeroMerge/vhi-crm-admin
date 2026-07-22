import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Send, Plus, MessageSquare, Trash2 } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedConv = conversations.find((c) => c.id === selectedConversationId);

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
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-lg border bg-white">
      {/* Left Panel — Conversation History */}
      <div className="flex w-72 shrink-0 flex-col border-r bg-gray-50">
        <div className="border-b bg-white p-3">
          <Button
            variant="default"
            className="w-full justify-start gap-2 bg-primary"
            onClick={onNewConversation}
          >
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
        </div>

        <div className="border-b bg-white px-3 pb-3 pt-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-xs text-gray-400 px-3 text-center">
              No conversations found
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 border-b px-3 py-3 transition-colors hover:bg-white",
                  selectedConversationId === conv.id
                    ? "bg-white border-l-2 border-l-primary"
                    : "border-l-2 border-l-transparent",
                )}
                onClick={() => onSelectConversation(conv.id)}
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm", conv.unread ? "font-semibold" : "font-medium")}>
                      {conv.title}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">{conv.timestamp}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-400">{conv.lastMessage}</p>
                </div>
                {onDeleteConversation && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                    className="shrink-0 rounded p-1 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel — Chat */}
      <div className="flex flex-1 flex-col">
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="flex items-center border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{selectedConv.title}</h2>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center h-full text-sm text-gray-400">
                  Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-gray-400">
                  Start a conversation
                </div>
              ) : (
                messages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex", isUser ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                          isUser
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : msg.role === "system"
                              ? "bg-yellow-50 text-yellow-800 border border-yellow-200"
                              : "bg-gray-100 text-gray-900 rounded-bl-md",
                        )}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p
                          className={cn(
                            "mt-1 text-right text-xs",
                            isUser ? "text-primary-foreground/60" : "text-gray-400",
                          )}
                        >
                          {msg.timestamp}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t px-4 py-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-10 flex-1"
                />
                <Button
                  size="icon"
                  className="h-10 w-10 shrink-0 bg-primary"
                  onClick={handleSend}
                  disabled={!input.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageSquare className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-2 text-sm text-gray-400">Select a conversation or start a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
