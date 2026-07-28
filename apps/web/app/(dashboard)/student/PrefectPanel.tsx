'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@school-manager/ui';
import { apiFetch } from '@/lib/api';

type PrefectStatus = {
  classPrefect: { id: string; classId: string; termId: string | null } | null;
  schoolPrefects: { id: string; role_title: string; term_id: string | null }[];
  powers: Record<string, boolean>;
};

type RosterStudent = { id: string; name: string };

// Self-contained: fetches its own status so it can be dropped into the
// student dashboard without extra server-side plumbing. Renders nothing at
// all for a non-prefect student.
export default function PrefectPanel() {
  const [status, setStatus] = useState<PrefectStatus | null>(null);
  const [showIncidentForm, setShowIncidentForm] = useState<'CLASS' | 'SCHOOL' | null>(null);
  const [showMessageForm, setShowMessageForm] = useState<'CLASS_TEACHER' | 'ADMIN' | null>(null);

  useEffect(() => {
    apiFetch<PrefectStatus>('/prefects/me').then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!status || (!status.classPrefect && status.schoolPrefects.length === 0)) return null;

  const canReportClass = !!status.classPrefect && status.powers['report_behavior_incident'];
  const canReportSchool = status.schoolPrefects.length > 0 && status.powers['report_behavior_incident_school_wide'];
  const canMessageTeacher = !!status.classPrefect && status.powers['compose_message_to_class_teacher'];
  const canMessageAdmin = status.schoolPrefects.length > 0 && status.powers['compose_message_to_admin'];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {status.classPrefect && <Badge variant="classPrefect">Class Prefect</Badge>}
        {status.schoolPrefects.map((sp) => (
          <Badge key={sp.id} variant="schoolPrefect">{sp.role_title}</Badge>
        ))}
        <Link href="/prefect-role-info" className="text-xs text-slate-500 hover:text-slate-600 underline">About this role</Link>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {status.classPrefect && status.powers['view_class_behavior_leaderboard'] && (
          <Link href="/leaderboard" className="text-xs font-medium border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50">
            View class leaderboard
          </Link>
        )}
        {(canReportClass || canReportSchool) && (
          <button onClick={() => setShowIncidentForm(canReportSchool ? 'SCHOOL' : 'CLASS')}
            className="text-xs font-medium bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700">
            Report Behavior Incident
          </button>
        )}
        {canMessageTeacher && (
          <button onClick={() => setShowMessageForm('CLASS_TEACHER')}
            className="text-xs font-medium border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50">
            Message your Class Teacher
          </button>
        )}
        {canMessageAdmin && (
          <button onClick={() => setShowMessageForm('ADMIN')}
            className="text-xs font-medium border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50">
            Message a School Admin
          </button>
        )}
      </div>

      {showIncidentForm && (
        <IncidentForm scope={showIncidentForm} onClose={() => setShowIncidentForm(null)} />
      )}
      {showMessageForm && (
        <MessageForm target={showMessageForm} onClose={() => setShowMessageForm(null)} />
      )}
    </div>
  );
}

const CATEGORIES = ['academic', 'attendance', 'citizenship', 'leadership', 'other'] as const;

function IncidentForm({ scope, onClose }: { scope: 'CLASS' | 'SCHOOL'; onClose: () => void }) {
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [studentId, setStudentId] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('other');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Reuses the RLS-scoped students read — a class prefect's own class
    // roster query is identical in shape to any other roster fetch in this
    // codebase; school-wide is naturally already RLS-scoped to the caller's
    // own school for any role.
    import('@/lib/supabase/client').then(({ createClient }) => {
      const supabase = createClient();
      const query = scope === 'CLASS'
        ? supabase.from('students').select('id, current_class_id, user:users!inner(full_name)').eq('is_active', true)
        : supabase.from('students').select('id, user:users!inner(full_name)').eq('is_active', true);
      query.then(({ data }) => {
        setStudents((data ?? []).map((s: any) => ({ id: s.id, name: s.user?.full_name ?? '' })));
      });
    });
  }, [scope]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId || description.trim().length < 20) return;
    setSubmitting(true);
    setError('');
    try {
      await apiFetch('/prefects/behavior-incidents', {
        method: 'POST',
        body: JSON.stringify({ studentId, category, description: description.trim() }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-700">
        Report submitted. Your Class Teacher has been notified.
        <button onClick={onClose} className="ml-2 underline">Close</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div>
        <label htmlFor="prefect-incident-student" className="block text-xs font-medium text-slate-600 mb-1">Student</label>
        <select id="prefect-incident-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} required className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">— select student —</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="prefect-incident-category" className="block text-xs font-medium text-slate-600 mb-1">Category</label>
        <select id="prefect-incident-category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="prefect-incident-description" className="block text-xs font-medium text-slate-600 mb-1">Description (at least 20 characters)</label>
        <textarea id="prefect-incident-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required minLength={20}
          aria-label="Description"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={submitting || description.trim().length < 20 || !studentId}
          className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
          {submitting ? 'Submitting…' : 'Submit report'}
        </button>
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
      </div>
    </form>
  );
}

function MessageForm({ target, onClose }: { target: 'CLASS_TEACHER' | 'ADMIN'; onClose: () => void }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiFetch(target === 'CLASS_TEACHER' ? '/prefects/message/class-teacher' : '/prefects/message/admin', {
        method: 'POST',
        body: JSON.stringify({ body: body.trim() }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-700">
        Message sent. This is a one-way notification — the recipient will see it in their notifications, not a reply thread.
        <button onClick={onClose} className="ml-2 underline">Close</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSend} className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div>
        <label htmlFor="prefect-message-body" className="block text-xs font-medium text-slate-600 mb-1">
          Message to {target === 'CLASS_TEACHER' ? 'your Class Teacher' : 'School Admin'}
        </label>
        <textarea id="prefect-message-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} required
          aria-label="Message"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none"
          placeholder="This is delivered as a one-way notification, not a chat — the recipient can't reply through this." />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={sending || !body.trim()} className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
      </div>
    </form>
  );
}
