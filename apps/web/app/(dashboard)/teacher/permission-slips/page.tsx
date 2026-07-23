'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import BackButton from '@/components/BackButton';

type Slip = { id: string; title: string; description: string | null; one_time_code: string; response_deadline: string | null; created_at: string };

function genCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

export default function TeacherPermissionSlipsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [classInfo, setClassInfo] = useState<{ id: string; name: string } | null>(null);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [deadline, setDeadline] = useState('');
  const [code] = useState(genCode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: userRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
      const { data: teacherRow } = await supabase
        .from('teachers')
        .select('is_class_teacher_of, class:classes!is_class_teacher_of(id, name)')
        .eq('user_id', userRow?.id ?? '')
        .maybeSingle();
      const cls = teacherRow?.class as unknown as { id: string; name: string } | null;
      if (teacherRow?.is_class_teacher_of && cls) {
        setClassInfo(cls);
        const { data } = await supabase
          .from('permission_slips')
          .select('id, title, description, one_time_code, response_deadline, created_at')
          .eq('target_class_id', cls.id)
          .order('created_at', { ascending: false });
        setSlips((data ?? []) as Slip[]);
      }
      setLoading(false);
    })();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!classInfo) return;
    setSaving(true);
    setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userRow } = await supabase.from('users').select('id, school_id').eq('auth_id', user?.id ?? '').maybeSingle();
    const { data, error: insertErr } = await supabase.from('permission_slips').insert({
      school_id: userRow?.school_id,
      created_by_id: userRow?.id,
      title: title.trim(),
      description: desc.trim() || null,
      audience: 'CLASS',
      target_class_id: classInfo.id,
      response_deadline: deadline || null,
      one_time_code: code,
    }).select('id, title, description, one_time_code, response_deadline, created_at').single();
    if (insertErr) {
      setError(insertErr.message);
    } else if (data) {
      await supabase.from('audit_logs').insert({
        school_id: userRow?.school_id,
        user_id: userRow?.id,
        action: 'class_teacher.permission_slip_approve',
        entity_type: 'permission_slip',
        entity_id: data.id,
        metadata: { classId: classInfo.id, title: data.title },
      });
      setSlips((p) => [data as Slip, ...p]);
      setShowForm(false); setTitle(''); setDesc(''); setDeadline('');
    }
    setSaving(false);
  }

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  if (!classInfo) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <BackButton href="/teacher" />
          <h1 className="text-2xl font-semibold">Permission slips</h1>
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Only the class teacher of a class can create permission slips for it.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Permission slips — {classInfo.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">Parents sign slips with a one-time code.</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">
          {showForm ? 'Cancel' : '+ New slip'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Response deadline</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">One-time code (share with parents)</label>
              <input value={code} readOnly className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono bg-slate-50" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50">{saving ? 'Creating…' : 'Create slip'}</button>
          </div>
        </form>
      )}

      {slips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No permission slips yet for this class.</div>
      ) : (
        <div className="space-y-2">
          {slips.map((s) => (
            <div key={s.id} className="bg-white border border-slate-100 rounded-xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-800">{s.title}</p>
                  {s.description && <p className="text-sm text-slate-500 mt-0.5">{s.description}</p>}
                  {s.response_deadline && <p className="text-xs text-slate-400 mt-1">Deadline: {s.response_deadline}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-slate-400 mb-1">Code</p>
                  <p className="font-mono font-bold text-slate-800 text-lg tracking-widest">{s.one_time_code}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
