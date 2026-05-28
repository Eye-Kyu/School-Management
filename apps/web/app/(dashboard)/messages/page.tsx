'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import UserAvatar from '@/components/UserAvatar';
import { createClient } from '@/lib/supabase/client';

type ConvUser = { id: string; full_name: string; avatar_url?: string | null };
type Student = { id: string; user: { full_name: string } };
type Conversation = {
  id: string;
  last_message_body: string | null;
  last_message_at: string | null;
  parent_unread_count: number;
  teacher_unread_count: number;
  is_flagged: boolean;
  parent: ConvUser;
  teacher: ConvUser;
  student: Student | null;
};
type Contact = { user_id: string; user: ConvUser };
type StudentRef = { id: string; current_class_id: string; user: { full_name: string } };

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export default function MessagesPage() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('');
  const [userId, setUserId] = useState('');

  // New conversation modal state
  const [showNew, setShowNew] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [students, setStudents] = useState<StudentRef[]>([]);
  const [selTeacher, setSelTeacher] = useState('');
  const [selStudent, setSelStudent] = useState('');
  const [firstMsg, setFirstMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) return;
      // Get current user role + id via a quick API call
      apiFetch<{ conversations: Conversation[] }>('/messaging/conversations')
        .then((r) => { setConvs((r as unknown as Conversation[])); setLoading(false); })
        .catch(() => setLoading(false));

      apiFetch<{ role: string; contacts: Contact[]; students?: StudentRef[] }>('/messaging/contacts')
        .then((r) => {
          setRole(r.role);
          setContacts(r.contacts ?? []);
          setStudents(r.students ?? []);
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load convs
  useEffect(() => {
    apiFetch<Conversation[]>('/messaging/conversations')
      .then((r) => { setConvs(r); setLoading(false); })
      .catch(() => setLoading(false));

    apiFetch<{ role: string; contacts: Contact[]; students?: StudentRef[] }>('/messaging/contacts')
      .then((r) => { setRole(r.role); setContacts(r.contacts ?? []); setStudents(r.students ?? []); })
      .catch(() => {});
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selTeacher || !firstMsg.trim()) return;
    setCreating(true); setCreateErr('');
    try {
      const result = await apiFetch<{ id: string }>('/messaging/conversations', {
        method: 'POST',
        body: JSON.stringify({ teacherUserId: selTeacher, studentId: selStudent || undefined, firstMessage: firstMsg.trim() }),
      });
      window.location.href = `/messages/${result.id}`;
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Failed to start conversation');
      setCreating(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {loading ? 'Loading…' : `${convs.length} conversation${convs.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {role === 'PARENT' && (
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            + New message
          </button>
        )}
      </div>

      {/* Conversation list */}
      {!loading && convs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No conversations yet.
          {role === 'PARENT' && (
            <p className="mt-2">
              <button onClick={() => setShowNew(true)} className="text-slate-600 underline">
                Send a message to your child's teacher.
              </button>
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {convs.map((c) => {
          const other = role === 'PARENT' ? c.teacher : c.parent;
          const unread = role === 'PARENT' ? c.parent_unread_count : c.teacher_unread_count;
          return (
            <Link
              key={c.id}
              href={`/messages/${c.id}`}
              className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 hover:shadow-sm transition-shadow ${
                unread > 0 ? 'border-blue-200' : 'border-slate-100'
              }`}
            >
              <div className="relative shrink-0">
                <UserAvatar name={other?.full_name ?? '?'} avatarUrl={other?.avatar_url} size={40} />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center ring-2 ring-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`text-sm font-medium truncate ${unread > 0 ? 'text-slate-900' : 'text-slate-700'}`}>
                    {other?.full_name ?? 'Unknown'}
                  </p>
                  {c.last_message_at && (
                    <span className="text-xs text-slate-400 shrink-0">{timeAgo(c.last_message_at)}</span>
                  )}
                </div>
                {c.student && (
                  <p className="text-xs text-slate-400">re: {(c.student as any)?.user?.full_name}</p>
                )}
                <p className={`text-xs mt-0.5 truncate ${unread > 0 ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                  {c.last_message_body ?? 'No messages yet'}
                </p>
              </div>
              {c.is_flagged && (
                <span className="shrink-0 text-xs bg-rose-100 text-rose-600 font-medium px-2 py-0.5 rounded-full">⚑ flagged</span>
              )}
            </Link>
          );
        })}
      </div>

      {/* New conversation modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">New message</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              {createErr && <p className="text-sm text-red-600">{createErr}</p>}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Teacher</label>
                <select
                  required
                  value={selTeacher}
                  onChange={(e) => setSelTeacher(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select a teacher…</option>
                  {contacts.map((c) => (
                    <option key={c.user_id} value={c.user_id}>{c.user.full_name}</option>
                  ))}
                </select>
              </div>
              {students.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Regarding child (optional)</label>
                  <select
                    value={selStudent}
                    onChange={(e) => setSelStudent(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Not specified</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>{s.user.full_name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
                <textarea
                  required
                  rows={4}
                  value={firstMsg}
                  onChange={(e) => setFirstMsg(e.target.value)}
                  maxLength={2000}
                  placeholder="Type your message…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowNew(false)}
                  className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                  {creating ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
