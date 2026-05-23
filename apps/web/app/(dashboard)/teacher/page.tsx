import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, DAYS, type Day } from '@/lib/utils/days';

export default async function TeacherHomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const today = todayEnum() as Day;

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, user:users!inner(full_name)')
    .eq('users.auth_id', user.id)
    .maybeSingle();

  const { data: todaySlots } = teacher
    ? await supabase
        .from('timetable_slots')
        .select('id, start_time, end_time, room, class:classes(id, name), subject:subjects(name)')
        .eq('teacher_id', teacher.id)
        .eq('day_of_week', today)
        .order('start_time')
    : { data: [] };

  const { data: weekSlots } = teacher
    ? await supabase
        .from('timetable_slots')
        .select('id, day_of_week, start_time, end_time, room, class:classes(name), subject:subjects(name)')
        .eq('teacher_id', teacher.id)
        .order('start_time')
    : { data: [] };

  const byDay = Object.groupBy(weekSlots ?? [], (s: any) => s.day_of_week);

  // Distinct classes for attendance card subtitle
  const { data: assignments } = teacher
    ? await supabase
        .from('subject_assignments')
        .select('class:classes!inner(id, name)')
        .eq('teacher_id', teacher.id)
    : { data: [] };

  const seen = new Set<string>();
  const myClasses = (assignments ?? [])
    .map((a: any) => a.class)
    .filter((c: any) => c && !seen.has(c.id) && seen.add(c.id));

  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, title, body, published_at')
    .order('published_at', { ascending: false })
    .limit(3);

  const firstName = (teacher?.user as any)?.full_name?.split(' ')[0] ?? 'Teacher';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Good {greeting()}, {firstName}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {DAY_LABELS[today]} · {(todaySlots ?? []).length} classes today
        </p>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Today's schedule card */}
        <Link href="/teacher/schedule" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-sky-500 to-blue-600 px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sky-100 text-xs font-medium uppercase tracking-wide">Today's Schedule</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-4xl font-bold text-white">{(todaySlots ?? []).length}</p>
              <p className="text-sky-100 text-sm mt-1">{DAY_LABELS[today]}</p>
            </div>
            <div className="bg-white px-5 py-3 space-y-1.5">
              {(todaySlots ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No classes today.</p>
              ) : (
                (todaySlots ?? []).slice(0, 3).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <span className="text-slate-400 text-xs w-16 shrink-0">{formatTime(s.start_time)}</span>
                    <span className="font-medium text-slate-700 truncate">{s.subject?.name}</span>
                    <span className="text-slate-400 text-xs truncate">{s.class?.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Link>

        {/* Attendance card */}
        <Link href="/teacher/attendance" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-emerald-100 text-xs font-medium uppercase tracking-wide">Mark Attendance</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-4xl font-bold text-white">{myClasses.length}</p>
              <p className="text-emerald-100 text-sm mt-1">
                {myClasses.length === 1 ? 'class assigned' : 'classes assigned'}
              </p>
            </div>
            <div className="bg-white px-5 py-3">
              <p className="text-sm text-slate-600">
                {myClasses.length === 0
                  ? 'No classes assigned yet.'
                  : myClasses.slice(0, 3).map((c: any) => c.name).join(', ')}
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Weekly overview */}
      <section>
        <h2 className="text-base font-semibold mb-3 text-slate-700">This week</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {DAYS.map((d) => {
            const daySlots: any[] = (byDay[d] ?? []) as any[];
            const isToday = d === today;
            return (
              <div key={d}
                className={`rounded-xl border p-3 ${isToday ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}>
                <p className={`text-xs font-semibold uppercase mb-2 ${isToday ? 'text-sky-600' : 'text-slate-400'}`}>
                  {DAY_LABELS[d]}
                </p>
                {daySlots.length === 0 ? (
                  <p className="text-slate-300 text-sm">—</p>
                ) : (
                  <div className="space-y-1.5">
                    {daySlots.map((s: any) => (
                      <div key={s.id}
                        className={`text-xs rounded-md px-2 py-1.5
                          ${isToday ? 'bg-sky-100 text-sky-800' : 'bg-slate-50 text-slate-700'}`}>
                        <p className="font-medium truncate">{s.subject?.name}</p>
                        <p className={`${isToday ? 'text-sky-500' : 'text-slate-400'}`}>{formatTime(s.start_time)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Announcements */}
      {(announcements ?? []).length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-3 text-slate-700">Announcements</h2>
          <div className="space-y-2">
            {(announcements ?? []).map((a: any) => (
              <div key={a.id}
                className="bg-white border border-slate-100 border-l-4 border-l-violet-500
                           rounded-r-xl px-5 py-3 shadow-sm">
                <p className="font-medium text-sm">{a.title}</p>
                <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{a.body}</p>
                <p className="text-xs text-slate-400 mt-1">{new Date(a.published_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
