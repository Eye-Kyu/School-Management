'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import BackButton from '@/components/BackButton';

type Slip = { id: string; title: string; description: string | null; one_time_code: string; response_deadline: string | null; created_at: string; _responseCount?: number };

function genCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

export default function PermissionSlipsPage() {
  const supabase = createClient();
  const [slips, setSlips] = useState<Slip[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [audience, setAudience] = useState('SCHOOL_WIDE');
  const [classId, setClassId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [code] = useState(genCode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('permission_slips').select('id, title, description, one_time_code, response_deadline, created_at').order('created_at', { ascending: false })
      .then(({ data }) => setSlips((data ?? []) as Slip[]));
    supabase.from('classes').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setClasses(data ?? []));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const { data: userRow } = await supabase.from('users').select('id, school_id').maybeSingle();
    const { data } = await supabase.from('permission_slips').insert({
      school_id: userRow?.school_id,
      created_by_id: userRow?.id,
      title: title.trim(),
      description: desc.trim() || null,
      audience,
      target_class_id: classId || null,
      response_deadline: deadline || null,
      one_time_code: code,
    }).select('id, title, description, one_time_code, response_deadline, created_at').single();
    if (data) setSlips((p) => [data as Slip, ...p]);
    setShowForm(false); setTitle(''); setDesc(''); setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Permission slips</h1>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="SCHOOL_WIDE">School-wide</option>
                <option value="CLASS">Specific class</option>
              </select>
            </div>
            {audience === 'CLASS' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Class</label>
                <select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
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
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No permission slips yet.</div>
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
