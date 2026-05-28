'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import BackButton from '@/components/BackButton';

type Grant = { id: string; substitute_user_id: string; class_id: string; grant_date: string; actions_allowed: string[]; sub_name?: string; class_name?: string };

export default function SubstitutesPage() {
  const supabase = createClient();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; user_id: string; name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [subUserId, setSubUserId] = useState('');
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [actions, setActions] = useState(['attendance', 'homework']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('substitute_grants')
      .select('id, substitute_user_id, class_id, grant_date, actions_allowed')
      .gte('grant_date', new Date().toISOString().slice(0, 10))
      .order('grant_date').then(({ data }) => setGrants((data ?? []) as Grant[]));

    supabase.from('teachers').select('id, user_id, user:users!user_id(full_name)').then(({ data }) =>
      setTeachers((data ?? []).map((t) => ({ id: t.id, user_id: t.user_id, name: ((t.user as any)?.full_name ?? '—') as string }))));

    supabase.from('classes').select('id, name').eq('is_active', true).order('name').then(({ data }) => setClasses(data ?? []));
  }, []);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const { data: userRow } = await supabase.from('users').select('id, school_id').maybeSingle();
    const { data } = await supabase.from('substitute_grants').upsert({
      school_id: userRow?.school_id,
      granted_by_id: userRow?.id,
      substitute_user_id: subUserId,
      class_id: classId,
      grant_date: date,
      actions_allowed: actions,
    }, { onConflict: 'substitute_user_id,class_id,grant_date' })
      .select('id, substitute_user_id, class_id, grant_date, actions_allowed').single();

    if (data) {
      const sub = teachers.find((t) => t.user_id === subUserId);
      const cls = classes.find((c) => c.id === classId);
      setGrants((p) => [{ ...data as Grant, sub_name: sub?.name, class_name: cls?.name }, ...p.filter((g) => g.id !== (data as any).id)]);
    }
    setSaving(false);
  }

  async function revokeGrant(id: string) {
    await supabase.from('substitute_grants').delete().eq('id', id);
    setGrants((p) => p.filter((g) => g.id !== id));
  }

  const subTeacher = teachers.find((t) => t.user_id === subUserId);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Substitute teachers</h1>
          <p className="text-sm text-slate-500 mt-0.5">Grant day-scoped access. Access expires automatically at end of day.</p>
        </div>
      </div>

      <form onSubmit={handleGrant} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-slate-800">Grant access</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Substitute teacher</label>
            <select value={subUserId} onChange={(e) => setSubUserId(e.target.value)} required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select teacher…</option>
              {teachers.map((t) => <option key={t.id} value={t.user_id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Class to cover</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)} required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select class…</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
              min={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Permitted actions</label>
            <div className="flex gap-2 flex-wrap pt-1">
              {['attendance', 'homework', 'announcements'].map((a) => (
                <label key={a} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={actions.includes(a)}
                    onChange={(e) => setActions((p) => e.target.checked ? [...p, a] : p.filter((x) => x !== a))} />
                  {a}
                </label>
              ))}
            </div>
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
          {saving ? 'Granting…' : 'Grant access'}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Active grants (today and future)</h2>
        {grants.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No active grants.</div>
        ) : grants.map((g) => (
          <div key={g.id} className="flex items-center gap-4 bg-white border border-slate-100 rounded-xl px-5 py-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800">{g.sub_name ?? g.substitute_user_id}</p>
              <p className="text-xs text-slate-400">Covering {g.class_name ?? g.class_id} · {g.grant_date} · {g.actions_allowed.join(', ')}</p>
            </div>
            <button onClick={() => revokeGrant(g.id)} className="text-xs text-rose-500 hover:text-rose-700 font-medium">Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}
