'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import BackButton from '@/components/BackButton';

type Student = { id: string; full_name: string; class_name: string };
type Point = { id: string; category: string; points: number; reason: string; date: string; student_id: string };

export default function TeacherBehaviourPage() {
  const supabase = createClient();
  const [students, setStudents] = useState<Student[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [studentId, setStudentId] = useState('');
  const [category, setCategory] = useState<'POSITIVE' | 'NEGATIVE'>('POSITIVE');
  const [pts, setPts] = useState('1');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [teacherId, setTeacherId] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: userRow } = await supabase.from('users').select('id').eq('auth_id', authUser?.id ?? '').maybeSingle();
      const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userRow?.id ?? '').maybeSingle();
      setTeacherId(teacher?.id ?? '');

      const { data: assigns } = await supabase.from('subject_assignments')
        .select('class:classes(id, name)').eq('teacher_id', teacher?.id ?? '');
      const classIds = [...new Set((assigns ?? []).map((a) => (a.class as any)?.id).filter(Boolean))];

      const { data: stds } = classIds.length
        ? await supabase.from('students').select('id, user:users!user_id(full_name), class:classes!current_class_id(name)')
            .in('current_class_id', classIds).eq('is_active', true)
        : { data: [] };
      setStudents((stds ?? []).map((s) => ({
        id: s.id,
        full_name: ((s.user as any)?.full_name ?? '—') as string,
        class_name: ((s.class as any)?.name ?? '—') as string,
      })));

      const { data: bp } = await supabase.from('behaviour_points')
        .select('id, category, points, reason, date, student_id')
        .eq('teacher_id', teacher?.id ?? '')
        .order('date', { ascending: false }).limit(50);
      setPoints((bp ?? []) as Point[]);
    })();
  }, []);

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const { data: userRow } = await supabase.from('users').select('id, school_id').eq('auth_id', authUser?.id ?? '').maybeSingle();
    const { data } = await supabase.from('behaviour_points').insert({
      school_id: userRow?.school_id,
      student_id: studentId,
      teacher_id: teacherId,
      category,
      points: parseInt(pts) || 1,
      reason: reason.trim(),
      date: new Date().toISOString().slice(0, 10),
    }).select('id, category, points, reason, date, student_id').single();
    if (data) setPoints((p) => [data as Point, ...p]);
    setReason(''); setSaving(false);
  }

  const studentMap = Object.fromEntries(students.map((s) => [s.id, s]));

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Behaviour log</h1>
          <p className="text-sm text-slate-500 mt-0.5">Record positive or negative behaviour points.</p>
        </div>
      </div>

      <form onSubmit={handleLog} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Student</label>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select student…</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.class_name})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCategory('POSITIVE')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${category === 'POSITIVE' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                + Positive
              </button>
              <button type="button" onClick={() => setCategory('NEGATIVE')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${category === 'NEGATIVE' ? 'bg-rose-600 text-white border-rose-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                − Negative
              </button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Points</label>
            <input type="number" min="1" max="10" value={pts} onChange={(e) => setPts(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={200}
              placeholder="e.g. Helped a classmate, Disrupted class"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
          {saving ? 'Logging…' : 'Log behaviour'}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Recent entries</h2>
        {points.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No entries yet.</div>
        ) : points.map((p) => (
          <div key={p.id} className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 ${p.category === 'POSITIVE' ? 'border-emerald-100' : 'border-rose-100'}`}>
            <span className={`text-sm font-bold w-8 text-center ${p.category === 'POSITIVE' ? 'text-emerald-600' : 'text-rose-600'}`}>
              {p.category === 'POSITIVE' ? '+' : '−'}{p.points}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{studentMap[p.student_id]?.full_name ?? '—'}</p>
              <p className="text-xs text-slate-400">{p.reason} · {p.date}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
