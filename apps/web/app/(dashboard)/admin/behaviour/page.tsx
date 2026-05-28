import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';

export default async function AdminBehaviourPage({ searchParams }: { searchParams: { classId?: string } }) {
  const supabase = createClient();

  const [{ data: classes }, { data: points }] = await Promise.all([
    supabase.from('classes').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('behaviour_points')
      .select('id, category, points, reason, date, student:students!student_id(user:users!user_id(full_name), class:classes!current_class_id(name)), teacher:teachers!teacher_id(user:users!user_id(full_name))')
      .order('date', { ascending: false })
      .limit(100),
  ]);

  const classId = searchParams.classId ?? '';
  const filtered = classId
    ? (points ?? []).filter((p) => ((p.student as any)?.class as any)?.name === (classes ?? []).find((c) => c.id === classId)?.name)
    : (points ?? []);

  const positiveTotal = (points ?? []).filter((p) => p.category === 'POSITIVE').reduce((s, p) => s + p.points, 0);
  const negativeTotal = (points ?? []).filter((p) => p.category === 'NEGATIVE').reduce((s, p) => s + p.points, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Behaviour overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">School-wide behaviour point log.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-5 py-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">+{positiveTotal}</p>
          <p className="text-xs text-slate-400">Positive points</p>
        </div>
        <div className="bg-rose-50 border border-rose-100 rounded-xl px-5 py-3 text-center">
          <p className="text-2xl font-bold text-rose-600">−{negativeTotal}</p>
          <p className="text-xs text-slate-400">Negative points</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <a href="/admin/behaviour" className={`text-sm px-3 py-1 rounded-full font-medium ${!classId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>All classes</a>
        {(classes ?? []).map((c) => (
          <a key={c.id} href={`/admin/behaviour?classId=${c.id}`}
            className={`text-sm px-3 py-1 rounded-full font-medium ${classId === c.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {c.name}
          </a>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No behaviour entries yet.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Student</th>
                <th className="px-4 py-2 text-left font-medium">Teacher</th>
                <th className="px-4 py-2 text-center font-medium">Points</th>
                <th className="px-4 py-2 text-left font-medium">Reason</th>
                <th className="px-4 py-2 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.id} className={`border-t border-slate-100 ${i % 2 ? 'bg-slate-50/40' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{((p.student as any)?.user as any)?.full_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{((p.teacher as any)?.user as any)?.full_name ?? '—'}</td>
                  <td className={`px-4 py-2.5 text-center font-bold ${p.category === 'POSITIVE' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {p.category === 'POSITIVE' ? '+' : '−'}{p.points}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{p.reason}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400 text-xs">{p.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
