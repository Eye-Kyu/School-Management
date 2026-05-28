'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';
import UserAvatar from '@/components/UserAvatar';

type Message = {
  id: string;
  sender_id: string;
  body: string;
  is_flagged: boolean;
  read_at: string | null;
  created_at: string;
};

type ConvUser = { id: string; full_name: string; avatar_url?: string | null };

export default function ThreadClient({
  conversationId,
  initialMessages,
  currentUserId,
  otherParty,
}: {
  conversationId: string;
  initialMessages: Message[];
  currentUserId: string;
  otherParty: ConvUser;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark as read on mount
  useEffect(() => {
    apiFetch(`/messaging/conversations/${conversationId}/read`, { method: 'PATCH' }).catch(() => {});
  }, [conversationId]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`conv-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => {
            if (prev.find((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Mark read if this is incoming
          if (msg.sender_id !== currentUserId) {
            apiFetch(`/messaging/conversations/${conversationId}/read`, { method: 'PATCH' }).catch(() => {});
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, currentUserId, supabase]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true); setError('');
    try {
      await apiFetch(`/messaging/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3 px-1">
        {messages.length === 0 && (
          <p className="text-center text-sm text-slate-400 py-10">No messages yet. Start the conversation!</p>
        )}
        {messages.map((msg) => {
          const isMine = msg.sender_id === currentUserId;
          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
              {!isMine && (
                <UserAvatar name={otherParty.full_name} avatarUrl={otherParty.avatar_url} size={28} />
              )}
              <div className={`max-w-[75%] group`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isMine
                      ? 'bg-slate-900 text-white rounded-br-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'
                  } ${msg.is_flagged ? 'ring-2 ring-rose-400' : ''}`}
                >
                  {msg.body}
                  {msg.is_flagged && (
                    <span className="ml-2 text-xs text-rose-300" title="Flagged for review">⚑</span>
                  )}
                </div>
                <p className={`text-[10px] mt-0.5 text-slate-400 ${isMine ? 'text-right' : 'text-left'}`}>
                  {new Date(msg.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  {isMine && msg.read_at && ' · Read'}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 bg-white pt-3 pb-2">
        {error && <p className="text-xs text-red-500 mb-1 px-1">{error}</p>}
        <form onSubmit={send} className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={2000}
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 max-h-32 overflow-y-auto"
            style={{ minHeight: '2.75rem' }}
          />
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="shrink-0 rounded-xl bg-slate-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {sending ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
