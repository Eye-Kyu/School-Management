'use client';

import { useState, useRef, useEffect } from 'react';
import BackButton from '@/components/BackButton';

type Message = { role: 'user' | 'assistant'; content: string; loading?: boolean };

export default function AiTutorPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm your school's AI tutor. I can help you understand topics from your curriculum. What would you like to learn about today?",
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const userMsg = input.trim();
    setInput('');
    setSending(true);

    // Add user message + loading assistant placeholder
    const history = messages
      .filter((m) => !m.loading)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    setMessages((p) => [
      ...p,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: '', loading: true },
    ]);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/ai/tutor`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await getToken()}`,
          },
          body: JSON.stringify({ question: userMsg, history }),
        },
      );

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const { text, error } = JSON.parse(data) as { text?: string; error?: string };
            if (error) throw new Error(error);
            if (text) {
              full += text;
              setMessages((p) => p.map((m, i) => i === p.length - 1 ? { ...m, content: full } : m));
            }
          } catch { /* ignore parse errors */ }
        }
      }

      setMessages((p) => p.map((m, i) => i === p.length - 1 ? { ...m, loading: false } : m));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setMessages((p) => p.map((m, i) => i === p.length - 1 ? { role: 'assistant', content: `Sorry, I couldn't get a response: ${msg}` } : m));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200 shrink-0">
        <BackButton href="/student" />
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-lg shrink-0">✨</div>
        <div>
          <p className="font-semibold text-slate-800">AI Tutor</p>
          <p className="text-xs text-slate-400">Answers from your school curriculum only</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 px-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs shrink-0 mt-0.5">✨</div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-slate-900 text-white rounded-br-sm'
                  : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'
              }`}
            >
              {m.loading && !m.content ? (
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} className="border-t border-slate-200 pt-3 pb-2 flex gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about any topic from your curriculum…"
          disabled={sending}
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-40 transition-colors"
        >
          Ask
        </button>
      </form>

      <p className="text-center text-xs text-slate-300 pb-1">
        Powered by Claude · Answers limited to school curriculum
      </p>
    </div>
  );
}

async function getToken(): Promise<string> {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? '';
}
