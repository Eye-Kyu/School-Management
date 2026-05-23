import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, DAYS, type Day } from '@/lib/utils/days';
import BackButton from '@/components/BackButton';

export default async function TeacherSchedulePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const today = todayEnum() as Day;

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, user:users!inner(full_name)')
    .eq('users.auth_id', user.id)
    .maybeSingle();

  const { data: weekSlots } = teacher
    ? await supabase
        .from('timetable_slots')
        .select('id, day_of_week, start_time, end_time, room, class:classes(name), subject:subjects(name)')
        .eq('teacher_id', teacher.id)
        .order('start_time')
    : { data: [] };

  const byDay = Object.groupBy(weekSlots ?? [], (s: any) => s.day_of_week);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">My schedule</h1>
          <p className="text-sm text-slate-500 mt-0.5">Full weekly timetable</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        {DAYS.map((d) => {
          const daySlots: any[] = (byDay[d] ?? []) as any[];
          const isToday = d === today;
          return (
            <div key={d}
              className={`rounded-xl border ${isToday ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}>
              <div className={`px-4 py-2.5 border-b ${isToday ? 'border-sky-200 bg-sky-100' : 'border-slate-100 bg-slate-50'}`}>
                <p className={`text-xs font-semibold uppercase ${isToday ? 'text-sky-700' : 'text-slate-500'}`}>
                  {DAY_LABELS[d]}
                </p>
                <p className={`text-xs ${isToday ? 'text-sky-500' : 'text-slate-400'}`}>
                  {daySlots.length} class{daySlots.length !== 1 ? 'es' : ''}
                </p>
              </div>
              <div className="p-3 space-y-2">
                {daySlots.length === 0 ? (
                  <p className="text-slate-300 text-sm py-2 text-center">Free</p>
                ) : (
                  daySlots.map((s: any) => (
                    <div key={s.id}
                      className={`rounded-lg px-3 py-2 text-xs
                        ${isToday ? 'bg-sky-100 border border-sky-200' : 'bg-slate-50 border border-slate-200'}`}>
                      <p className="font-semibold text-slate-800">{s.subject?.name}</p>
                      <p className={`mt-0.5 ${isToday ? 'text-sky-600' : 'text-slate-500'}`}>
                        {formatTime(s.start_time)} – {formatTime(s.end_time)}
                      </p>
                      <p className="text-slate-400 mt-0.5">{s.class?.name}</p>
                      {s.room && <p className="text-slate-400">{s.room}</p>}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
