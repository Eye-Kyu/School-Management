import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';

const STATUS_STYLE: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700',
  ABSENT:  'bg-rose-100 text-rose-700',
  LATE:    'bg-amber-100 text-amber-700',
  EXCUSED: 'bg-slate-100 text-slate-600',
};

export default async function ParentAttendancePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('auth_id', user.id)
    .maybeSingle();

  const { data: guardianLinks } = userRow
    ? await supabase
        .from('guardians')
        .select('student:students!inner(id, user:users!inner(full_name))')
        .eq('user_id', userRow.id)
    : { data: [] };

  const students = (guardianLinks ?? []).map((g: any) => g.student).filter(Boolean);
  const firstStudent = students[0];

  const { data: currentTerm } = await supabase
    .from('terms')
    .select('id, name, start_date, end_date')
    .eq('is_current', true)
    .maybeSingle();

  // A term whose date range doesn't cover today (ended, or the next one
  // hasn't been marked current yet) must never filter out today's record.
  const todayDate = new Date().toISOString().slice(0, 10);
  const termCoversToday = !!currentTerm && todayDate >= currentTerm.start_date && todayDate <= currentTerm.end_date;
  const attQuery = firstStudent
    ? supabase.from('attendance_records').select('id, date, status, note')
        .eq('student_id', firstStudent.id).order('date', { ascending: false })
    : null;
  const { data: records } = attQuery
    ? termCoversToday
      ? await attQuery.gte('date', currentTerm!.start_date).lte('date', currentTerm!.end_date)
      : await attQuery
    : { data: [] };

  const total = (records ?? []).length;
  const present = (records ?? []).filter((r) => r.status === 'PRESENT').length;
  const late = (records ?? []).filter((r) => r.status === 'LATE').length;
  const absent = (records ?? []).filter((r) => r.status === 'ABSENT').length;
  const excused = (records ?? []).filter((r) => r.status === 'EXCUSED').length;
  const rate = total > 0 ? Math.round(((present + late) / total) * 100) : null;

  const childName = (firstStudent?.user as any)?.full_name ?? 'Your child';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">{childName}'s attendance</h1>
          <p className="text-sm text-slate-500 mt-0.5">{currentTerm?.name ?? 'Current term'}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-emerald-700">{present}</p>
          <p className="text-xs text-emerald-600 mt-1 font-medium">Present</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-amber-700">{late}</p>
          <p className="text-xs text-amber-600 mt-1 font-medium">Late</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-rose-700">{absent}</p>
          <p className="text-xs text-rose-600 mt-1 font-medium">Absent</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-slate-600">{excused}</p>
          <p className="text-xs text-slate-500 mt-1 font-medium">Excused</p>
        </div>
      </div>

      {/* Rate bar */}
      {rate !== null && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">Attendance rate</span>
            <span className={`text-lg font-bold ${rate >= 80 ? 'text-emerald-600' : rate >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
              {rate}%
            </span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${rate >= 80 ? 'bg-emerald-500' : rate >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
              style={{ width: `${rate}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">{total} days recorded · {present + late} attended</p>
        </div>
      )}

      {/* Records table */}
      {(records ?? []).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-500">
          No attendance records yet this term.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(records ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">
                    {new Date(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status] ?? ''}`}>
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
