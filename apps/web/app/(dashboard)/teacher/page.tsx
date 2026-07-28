import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, groupByDay, DAY_LABELS, DAYS, type Day } from '@/lib/utils/days';
import UpcomingEvents from '@/components/UpcomingEvents';
import RoleBadgeList from '@/components/RoleBadgeList';
import { getMyRoleBadges } from '@/lib/roleBadges';
import TodaysChecklist from './TodaysChecklist';

export default async function TeacherHomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const today = todayEnum() as Day;

  const { data: _uRow } = await supabase
    .from('users').select('id, full_name').eq('auth_id', user.id).maybeSingle();
  const { data: teacher } = _uRow
    ? await supabase.from('teachers').select('id').eq('user_id', _uRow.id).maybeSingle()
    : { data: null };
  const teacherFullName = _uRow?.full_name as string | null;

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

  const byDay = groupByDay(weekSlots ?? []);

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

  const { data: school } = await supabase.from('schools').select('timezone').maybeSingle();

  const badges = _uRow ? await getMyRoleBadges(supabase, _uRow.id, 'TEACHER') : [];

  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, title, body, published_at')
    .or(`expires_at.is.null,expires_at.gte.${new Date().toISOString().slice(0, 10)}`)
    .order('published_at', { ascending: false })
    .limit(3);

  const now = new Date().toISOString();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id, title, starts_at, ends_at, all_day, event_type')
    .gte('starts_at', now)
    .lte('starts_at', in30Days)
    .order('starts_at')
    .limit(10);

  const firstName = teacherFullName?.split(' ')[0] ?? 'Teacher';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Good {greeting()}, {firstName}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {DAY_LABELS[today]} · {(todaySlots ?? []).length} classes today
        </p>
        {badges.length > 0 && <RoleBadgeList badges={badges} className="mt-2" />}
      </div>

      {teacher && (
        <TodaysChecklist teacherId={teacher.id} timezone={school?.timezone ?? 'Africa/Nairobi'} />
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-2 gap-4">

        {/* Today's schedule card */}
        <Link href="/teacher/schedule" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-sky-500 to-blue-600 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sky-100 text-xs font-medium uppercase tracking-wide">Today's Schedule</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white">{(todaySlots ?? []).length}</p>
              <p className="text-sky-100 text-sm mt-1">{DAY_LABELS[today]}</p>
            </div>
            <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3 space-y-1.5">
              {(todaySlots ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No classes today.</p>
              ) : (
                (todaySlots ?? []).slice(0, 3).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <span className="text-slate-500 text-xs w-16 shrink-0">{formatTime(s.start_time)}</span>
                    <span className="font-medium text-slate-700 truncate">{s.subject?.name}</span>
                    <span className="text-slate-500 text-xs truncate">{s.class?.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Link>

        {/* Attendance card */}
        <Link href="/teacher/attendance" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-emerald-100 text-xs font-medium uppercase tracking-wide">Mark Attendance</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white">{myClasses.length}</p>
              <p className="text-emerald-100 text-sm mt-1">
                {myClasses.length === 1 ? 'class assigned' : 'classes assigned'}
              </p>
            </div>
            <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3">
              <p className="text-sm text-slate-600">
                {myClasses.length === 0
                  ? 'No classes assigned yet.'
                  : myClasses.slice(0, 3).map((c: any) => c.name).join(', ')}
              </p>
            </div>
          </div>
        </Link>

        {/* Assessments card */}
        <Link href="/teacher/assessments" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-violet-500 to-purple-600 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-violet-100 text-xs font-medium uppercase tracking-wide">Assessments</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white">+</p>
              <p className="text-violet-100 text-sm mt-1">Record marks</p>
            </div>
            <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3">
              <p className="text-sm text-slate-600">Create tests and enter student scores.</p>
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
                <p className={`text-xs font-semibold uppercase mb-2 ${isToday ? 'text-sky-600' : 'text-slate-500'}`}>
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
                        <p className={`${isToday ? 'text-sky-500' : 'text-slate-500'}`}>{formatTime(s.start_time)}</p>
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
                <p className="text-xs text-slate-500 mt-1">{new Date(a.published_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <UpcomingEvents events={(events ?? []) as any[]} />
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
