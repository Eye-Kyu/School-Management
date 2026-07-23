'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import UserAvatar from '@/components/UserAvatar';

type ConvUser = { id: string; full_name: string; avatar_url?: string | null };
type Conversation = {
  id: string;
  last_message_body: string | null;
  last_message_at: string | null;
  parent_unread_count: number;
  teacher_unread_count: number;
  admin_unread_count: number;
  is_flagged: boolean;
  parent: ConvUser | null;
  teacher: ConvUser | null;
  admin: ConvUser | null;
  student: { id: string; user: { full_name: string } } | null;
};
type TeacherContact = { user_id: string; user: ConvUser; studentIds?: string[]; studentNames?: string[] };
type StudentRef = { id: string; user: { full_name: string } };

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export default function MessagesClient({
  role,
  initialConversations,
  userId,
  classTeacherOf,
}: {
  role: string;
  initialConversations: Conversation[];
  userId: string;
  classTeacherOf?: { id: string; name: string } | null;
}) {
  const [convs] = useState(initialConversations);
  const [loading] = useState(false);

  const isParent = role === 'PARENT';
  const isTeacher = role === 'TEACHER';
  const isAdmin = role === 'ADMIN';
  const canCompose = isParent || isTeacher || isAdmin;

  // Compose modal state
  const [showCompose, setShowCompose] = useState(false);
  const [teacherContacts, setTeacherContacts] = useState<TeacherContact[]>([]);
  const [adminTeachers, setAdminTeachers] = useState<ConvUser[]>([]);
  const [adminParents, setAdminParents] = useState<ConvUser[]>([]);
  const [students, setStudents] = useState<StudentRef[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [adminTab, setAdminTab] = useState<'TEACHER' | 'PARENT'>('TEACHER');
  const [selRecipient, setSelRecipient] = useState('');
  const [selStudent, setSelStudent] = useState('');
  const [bypassQuietHours, setBypassQuietHours] = useState(false);
  const [firstMsg, setFirstMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  // Load contacts when compose is opened
  async function openCompose() {
    setShowCompose(true);
    setCreateErr('');
    setFirstMsg('');
    setSelRecipient('');
    setSelStudent('');
    setBypassQuietHours(false);
    const alreadyLoaded = isAdmin
      ? adminTeachers.length > 0 || adminParents.length > 0
      : teacherContacts.length > 0;
    if (alreadyLoaded) return;
    setContactsLoading(true);
    try {
      const data = await apiFetch<{
        role: string;
        contacts?: TeacherContact[];
        students?: StudentRef[];
        teachers?: ConvUser[];
        parents?: ConvUser[];
      }>('/messaging/contacts');
      if (isAdmin) {
        setAdminTeachers(data.teachers ?? []);
        setAdminParents(data.parents ?? []);
      } else {
        setTeacherContacts(data.contacts ?? []);
        setStudents(data.students ?? []);
      }
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Could not load contacts. Please try again.');
    } finally {
      setContactsLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selRecipient || !firstMsg.trim()) return;
    setCreating(true);
    setCreateErr('');
    try {
      const result = await apiFetch<{ id: string }>('/messaging/conversations', {
        method: 'POST',
        body: JSON.stringify({
          recipientUserId: selRecipient,
          ...(isAdmin ? { recipientRole: adminTab, bypassQuietHours } : {}),
          ...(!isAdmin ? { studentId: selStudent || undefined } : {}),
          firstMessage: firstMsg.trim(),
        }),
      });
      window.location.href = `/messages/${result.id}`;
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Failed to start conversation');
      setCreating(false);
    }
  }

  const recipientLabel = isTeacher ? 'Parent' : 'Teacher';
  const currentRecipientList: ConvUser[] = adminTab === 'TEACHER' ? adminTeachers : adminParents;

  // Broadcast to class parents (Class Teacher only)
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastErr, setBroadcastErr] = useState('');
  const [broadcastDone, setBroadcastDone] = useState<number | null>(null);

  async function handleBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!classTeacherOf || !broadcastBody.trim()) return;
    setBroadcasting(true);
    setBroadcastErr('');
    try {
      const result = await apiFetch<{ sent: number }>('/messaging/broadcast', {
        method: 'POST',
        body: JSON.stringify({ classId: classTeacherOf.id, body: broadcastBody.trim() }),
      });
      setBroadcastDone(result.sent);
      setBroadcastBody('');
    } catch (err) {
      setBroadcastErr(err instanceof Error ? err.message : 'Failed to send broadcast');
    } finally {
      setBroadcasting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {loading ? 'Loading…' : `${convs.length} conversation${convs.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {classTeacherOf && (
            <button
              onClick={() => { setShowBroadcast(true); setBroadcastErr(''); setBroadcastDone(null); }}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Broadcast to class
            </button>
          )}
          {canCompose && (
            <button
              onClick={openCompose}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Compose
            </button>
          )}
        </div>
      </div>

      {/* Conversation list */}
      {convs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No conversations yet.
          {canCompose && (
            <p className="mt-2">
              <button onClick={openCompose} className="text-slate-600 underline">
                {isParent ? "Send a message to your child's teacher." : 'Start a new conversation.'}
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {convs.map((c) => {
            const other = [c.parent, c.teacher, c.admin].find((u) => u && u.id !== userId) ?? null;
            const unread = isParent
              ? c.parent_unread_count
              : isTeacher
                ? c.teacher_unread_count
                : c.admin_unread_count;
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
                  <span className="shrink-0 text-xs bg-rose-100 text-rose-600 font-medium px-2 py-0.5 rounded-full">⚑</span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">New message</h2>
              <button onClick={() => setShowCompose(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none w-8 h-8 flex items-center justify-center">
                ×
              </button>
            </div>

            {contactsLoading ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading contacts…</p>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                {createErr && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{createErr}</p>
                )}

                {isAdmin && (
                  <div className="flex gap-2">
                    {(['TEACHER', 'PARENT'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => { setAdminTab(tab); setSelRecipient(''); }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          adminTab === tab ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {tab === 'TEACHER' ? 'Teachers' : 'Parents'}
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {isAdmin ? (adminTab === 'TEACHER' ? 'Teacher' : 'Parent') : recipientLabel}
                  </label>
                  <select
                    required
                    value={selRecipient}
                    onChange={(e) => setSelRecipient(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {isAdmin
                      ? currentRecipientList.map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name}</option>
                        ))
                      : teacherContacts.map((c) => (
                          <option key={c.user_id} value={c.user_id}>
                            {c.user.full_name}
                            {isTeacher && c.studentNames && c.studentNames.length > 1
                              ? ` (parent of ${c.studentNames.join(', ')})`
                              : ''}
                          </option>
                        ))}
                  </select>
                  {!isAdmin && teacherContacts.length === 0 && !contactsLoading && (
                    <p className="text-xs text-amber-600 mt-1">
                      {isTeacher
                        ? 'No parents found. You need to be assigned to a class with enrolled students.'
                        : "No teachers found. Make sure your child is enrolled in a class with assigned teachers."}
                    </p>
                  )}
                </div>

                {!isAdmin && students.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Regarding (optional)
                    </label>
                    <select
                      value={selStudent}
                      onChange={(e) => setSelStudent(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Not specified</option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.user?.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {isAdmin && (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={bypassQuietHours}
                      onChange={(e) => setBypassQuietHours(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Send even during the teacher&apos;s quiet hours
                  </label>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
                  <textarea
                    required
                    rows={4}
                    value={firstMsg}
                    onChange={(e) => setFirstMsg(e.target.value)}
                    maxLength={2000}
                    placeholder="Type your message here…"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCompose(false)}
                    className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating || !selRecipient || !firstMsg.trim()}
                    className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                  >
                    {creating ? 'Sending…' : 'Send message'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Broadcast modal (Class Teacher only) */}
      {showBroadcast && classTeacherOf && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Broadcast to {classTeacherOf.name} parents</h2>
              <button onClick={() => setShowBroadcast(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none w-8 h-8 flex items-center justify-center">
                ×
              </button>
            </div>

            {broadcastDone !== null ? (
              <div className="space-y-3">
                <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                  Sent to {broadcastDone} parent{broadcastDone !== 1 ? 's' : ''}, each as their own conversation.
                </p>
                <button onClick={() => setShowBroadcast(false)}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleBroadcast} className="space-y-3">
                <p className="text-xs text-slate-500">
                  Sends the same message to every parent in {classTeacherOf.name}, as an individual conversation
                  each parent can reply to — not a group thread.
                </p>
                {broadcastErr && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{broadcastErr}</p>
                )}
                <textarea
                  required
                  rows={5}
                  value={broadcastBody}
                  onChange={(e) => setBroadcastBody(e.target.value)}
                  maxLength={2000}
                  placeholder="Type your message to the class…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none"
                />
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setShowBroadcast(false)}
                    className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={broadcasting || !broadcastBody.trim()}
                    className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                  >
                    {broadcasting ? 'Sending…' : 'Send to class'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
