import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, DAYS, type Day } from '@/lib/utils/days';
import BackButton from '@/components/BackButton';

export default async function ParentTimetablePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const today = todayEnum() as Day;

  const { data: userRow } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('auth_id', user.id)
    .maybeSingle();

  const { data: guardianLinks } = userRow
    ? await supabase
        .from('guardians')
        .select('student:students!inner(id, current_class_id, user:users!inner(full_name))')
        .eq('user_id', userRow.id)
    : { data: [] };

  const students = (guardianLinks ?? []).map((g: any) => g.student).filter(Boolean);
  const firstStudent = students[0];
  const classId = firstStudent?.current_class_id;

  const { data: weekSlots } = classId
    ? await supabase
        .from('timetable_slots')
        .select('id, day_of_week, start_time, end_time, room, subject:subjects(name), teacher:teachers!inner(user:users!inner(full_name))')
        .eq('class_id', classId)
        .order('start_time')
    : { data: [] };

  const byDay = Object.groupBy(weekSlots ?? [], (s: any) => s.day_of_week);
  const childName = (firstStudent?.user as any)?.full_name ?? 'Your child';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">{childName}'s timetable</h1>
          <p className="text-sm text-slate-500 mt-0.5">Weekly class schedule</p>
        </div>
      </div>

      {!classId ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-400">
          {childName} hasn't been assigned to a class yet.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {DAYS.map((d) => (
                  <th key={d}
                    className={`px-3 py-2.5 text-xs font-semibold text-left
                      ${d === today ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
                    {DAY_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                {DAYS.map((d) => {
                  const daySlots: any[] = (byDay[d] ?? []) as any[];
                  return (
                    <td key={d}
                      className={`px-3 py-3 border-r border-slate-100 last:border-r-0
                        ${d === today ? 'bg-indigo-50' : ''}`}>
                      {daySlots.length === 0 ? (
                        <span className="text-slate-300 text-sm">—</span>
                      ) : (
                        <div className="space-y-2">
                          {daySlots.map((s: any) => (
                            <div key={s.id}
                              className={`rounded-lg px-2.5 py-2 text-xs
                                ${d === today ? 'bg-indigo-100 border border-indigo-200' : 'bg-slate-50 border border-slate-200'}`}>
                              <p className="font-semibold text-slate-800">{s.subject?.name}</p>
                              <p className={`mt-0.5 ${d === today ? 'text-indigo-600' : 'text-slate-400'}`}>
                                {formatTime(s.start_time)}
                              </p>
                              <p className="text-slate-400 mt-0.5 truncate">
                                {(s.teacher?.user as any)?.full_name}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
