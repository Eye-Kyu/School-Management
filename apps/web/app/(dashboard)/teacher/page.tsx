import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, groupByDay, DAY_LABELS, DAYS, type Day } from '@/lib/utils/days';
import UpcomingEvents from '@/components/UpcomingEvents';
import RoleBadgeList from '@/components/RoleBadgeList';
import { getMyRoleBadges } from '@/lib/roleBadges';
import TodaysChecklist from './TodaysChecklist';
import { DashboardFeed } from '@/components/DashboardFeed/DashboardFeed';
import DeniedBanner from '@/components/DeniedBanner';

export default async function TeacherHomePage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
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

  const slots = (todaySlots ?? []) as any[];

  return (
    <div className="space-y-10">
      <DeniedBanner reason={searchParams.denied} />

      {/* Greeting */}
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Good {greeting()}, {firstName}</h1>
        <p className="text-base text-slate-600 mt-2">
          {DAY_LABELS[today]}, {slots.length} {slots.length === 1 ? 'class' : 'classes'} today
        </p>
        {badges.length > 0 && <RoleBadgeList badges={badges} className="mt-3" />}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Today's periods, written up on the board */}
        <section className="chalkboard" aria-labelledby="board-heading">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
            <h2 id="board-heading" className="text-xl font-semibold">Today&apos;s schedule</h2>
            <Link href="/teacher/schedule" className="link text-sm font-semibold">Full schedule</Link>
          </div>
          {slots.length === 0 ? (
            <p className="chalk-muted py-6">No classes today.</p>
          ) : (
            <ol>
              {slots.map((s) => (
                <li key={s.id} className="chalk-period">
                  <span className="text-sm tabular chalk-muted">{formatTime(s.start_time)}</span>
                  <span className="min-w-0 font-semibold truncate">{s.subject?.name}</span>
                  <span className="text-sm chalk-muted truncate">{s.class?.name}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="space-y-4">
          {/* The day's one action */}
          <div className="sheet p-5">
            <p className="text-3xl font-semibold tabular">
              {myClasses.length}{' '}
              <span className="text-base font-medium text-slate-600">
                {myClasses.length === 1 ? 'class assigned' : 'classes assigned'}
              </span>
            </p>
            <p className="text-sm text-slate-600 mt-1 truncate">
              {myClasses.length === 0
                ? 'No classes assigned yet.'
                : myClasses.slice(0, 3).map((c: any) => c.name).join(', ')}
            </p>
            <Link href="/teacher/attendance" className="stock stock--pear mt-4 w-full">
              Mark attendance
            </Link>
          </div>

          <Link href="/teacher/assessments" className="statement">
            <span className="text-sm font-semibold text-slate-600">Assessments</span>
            <span className="block text-xl font-semibold mt-1">Record marks</span>
            <span className="block text-sm text-slate-600 mt-1">Create tests and enter student scores.</span>
          </Link>
        </div>
      </div>

      {teacher && (
        <TodaysChecklist teacherId={teacher.id} timezone={school?.timezone ?? 'Africa/Nairobi'} />
      )}

      {/* Weekly overview, as a register */}
      <section aria-labelledby="week-heading">
        <h2 id="week-heading" className="text-lg font-semibold mb-4">This week</h2>
        <div className="register">
          {DAYS.map((d) => {
            const daySlots: any[] = (byDay[d] ?? []) as any[];
            const isToday = d === today;
            return (
              <div key={d} className="register-day" aria-current={isToday ? 'date' : undefined}>
                <p className={`text-sm font-semibold mb-2 ${isToday ? 'text-slate-900' : 'text-slate-600'}`}>
                  {DAY_LABELS[d]}{isToday ? ', today' : ''}
                </p>
                {daySlots.length === 0 ? (
                  <p className="text-slate-500 text-sm">No classes</p>
                ) : (
                  <ul className="space-y-2">
                    {daySlots.map((s: any) => (
                      <li key={s.id} className="text-sm leading-snug">
                        <span className="block font-semibold truncate">{s.subject?.name}</span>
                        <span className="block text-slate-600 tabular text-xs">
                          {formatTime(s.start_time)}{s.class?.name ? `, ${s.class.name}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* What's new for you */}
      {_uRow && (
        <section>
          <h2 className="text-lg font-semibold mb-4">What&apos;s new for you</h2>
          <DashboardFeed userId={_uRow.id} role="TEACHER" />
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
