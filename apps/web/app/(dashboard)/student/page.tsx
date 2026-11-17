import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, type Day } from '@/lib/utils/days';
import UpcomingEvents from '@/components/UpcomingEvents';
import RoleBadgeList from '@/components/RoleBadgeList';
import { getMyRoleBadges } from '@/lib/roleBadges';
import PrefectPanel from './PrefectPanel';
import { DashboardFeed } from '@/components/DashboardFeed/DashboardFeed';
import { fetchAttendanceData } from '@/lib/attendance/fetchAttendanceData';
import { calculateAttendanceRate } from '@school-manager/types';

export default async function StudentHomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const today = todayEnum() as Day;

  const { data: _uRow } = await supabase
    .from('users').select('id, full_name').eq('auth_id', user.id).maybeSingle();
  const { data: student } = _uRow
    ? await supabase.from('students').select('id, current_class_id').eq('user_id', _uRow.id).maybeSingle()
    : { data: null };
  // Attach name for greeting
  const studentUser = _uRow;

  const classId = student?.current_class_id;
  const studentId = student?.id;

  // Today's timetable slots
  const { data: todaySlots } = classId
    ? await supabase
        .from('timetable_slots')
        .select('id, start_time, end_time, room, subject:subjects(name), teacher:teachers!inner(user:users!inner(full_name))')
        .eq('class_id', classId)
        .eq('day_of_week', today)
        .order('start_time')
    : { data: [] };

  // Current term
  const { data: currentTerm } = await supabase
    .from('terms')
    .select('id, name, start_date, end_date')
    .eq('is_current', true)
    .maybeSingle();

  const todayDate = new Date().toISOString().slice(0, 10);

  // Attendance summary — show regardless of whether a current term is set.
  // Only apply the term date range when it actually covers today; otherwise
  // (term ended, gap before the next one is marked current, stale seed data)
  // the filter would silently exclude attendance marked today, making a
  // freshly-marked record look like it never reflected on the dashboard.
  const termCoversToday = !!currentTerm && todayDate >= currentTerm.start_date && todayDate <= currentTerm.end_date;
  // No reliable current term covering today — widen to "all time up to
  // today" rather than leaving the range unbounded (the approved-absences
  // endpoint requires explicit start/end dates).
  const attendanceRange = termCoversToday
    ? { startDate: currentTerm!.start_date, endDate: currentTerm!.end_date }
    : { startDate: '2000-01-01', endDate: todayDate };

  const attendanceInput = studentId
    ? await fetchAttendanceData(supabase, studentId, attendanceRange)
    : { records: [], approvedAbsences: [] };

  const attPresent = attendanceInput.records.filter((r) => r.status === 'PRESENT').length;
  const attLate = attendanceInput.records.filter((r) => r.status === 'LATE').length;
  const attAbsent = attendanceInput.records.filter((r) => r.status === 'ABSENT').length;
  const attOverall = calculateAttendanceRate(attendanceInput);
  const attRate = attOverall.total_school_days > 0 ? Math.round(attOverall.attendance_rate) : null;

  // Today's status — always queried by exact date, never term-range filtered,
  // so it can never be silently excluded by term-boundary staleness.
  const { data: todayAttendance } = studentId
    ? await supabase
        .from('attendance_records')
        .select('status, updated_at')
        .eq('student_id', studentId)
        .eq('date', todayDate)
        .maybeSingle()
    : { data: null };

  const now = new Date().toISOString();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id, title, starts_at, ends_at, all_day, event_type')
    .gte('starts_at', now)
    .lte('starts_at', in30Days)
    .order('starts_at')
    .limit(10);

  // Best Student — Term X badge, private to this student (never shown on
  // any listing a peer or parent could see).
  const { data: bestStudentAward } = studentId && currentTerm
    ? await supabase.from('best_student_awards').select('id').eq('student_id', studentId).eq('term_id', currentTerm.id).maybeSingle()
    : { data: null };

  const firstName = (studentUser?.full_name as string | null)?.split(' ')[0] ?? 'Student';
  const badges = _uRow ? await getMyRoleBadges(supabase, _uRow.id, 'STUDENT') : [];

  const slots = (todaySlots ?? []) as any[];
  const attTone =
    attRate === null ? 'bg-slate-200'
    : attRate >= 80 ? 'bg-mint'
    : attRate >= 60 ? 'bg-pear'
    : 'bg-coral';

  return (
    <div className="space-y-10">
      <PrefectPanel />

      {/* Greeting */}
      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Good {greeting()}, {firstName}
          </h1>
          {bestStudentAward && (
            <span className="student-sticker">
              Best Student, {currentTerm?.name}
            </span>
          )}
        </div>
        <p className="text-base text-slate-600 mt-2">
          {DAY_LABELS[today]}, <span className="highlight">{slots.length} {slots.length === 1 ? 'class' : 'classes'} today</span>
        </p>
        {badges.length > 0 && <RoleBadgeList badges={badges} className="mt-3" />}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Today: each lesson a card-stock tile in its own colour */}
        <section aria-labelledby="today-heading">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 id="today-heading" className="text-xl font-semibold">Today&apos;s classes</h2>
            <Link href="/student/timetable" className="link text-sm font-semibold">Full timetable</Link>
          </div>
          {slots.length === 0 ? (
            <div className="ruled-page">
              <p className="font-semibold">No classes scheduled today.</p>
              <p className="text-slate-600">
                Check the <Link href="/student/timetable" className="link">week ahead</Link>.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {slots.map((s, i) => (
                <li key={s.id} className={`lesson-tile lesson-tile--${i % 4}`}>
                  <span className="lesson-time tabular">{formatTime(s.start_time)}</span>
                  <span className="lesson-label min-w-0">
                    <span className="block font-semibold text-lg leading-tight truncate">{s.subject?.name}</span>
                    <span className="block text-sm text-slate-600 truncate">
                      {[s.teacher?.user?.full_name, s.room && (/^\d/.test(s.room) ? `Room ${s.room}` : s.room)].filter(Boolean).join(', ')}
                    </span>
                  </span>
                  <span className="lesson-end tabular">until {formatTime(s.end_time)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="space-y-5">
          {/* Attendance */}
          <Link href="/student/attendance" className="student-card group block">
            <div className={`${attTone} px-6 pt-5 pb-6`}>
              <p className="text-sm font-semibold">Attendance, {currentTerm?.name ?? 'current term'}</p>
              <p className="text-6xl font-semibold tracking-tight tabular mt-2">
                {attRate !== null ? `${attRate}%` : '—'}
              </p>
            </div>
            <div className="px-6 py-4 space-y-3">
              {todayAttendance ? (
                <p className="text-sm flex flex-wrap items-center gap-2">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    todayAttendance.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-800'
                    : todayAttendance.status === 'LATE' ? 'bg-amber-100 text-amber-800'
                    : todayAttendance.status === 'ABSENT' ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-100 text-slate-700'
                  }`}>
                    {todayAttendance.status.charAt(0) + todayAttendance.status.slice(1).toLowerCase()} today
                  </span>
                  <span className="text-slate-500 text-xs">
                    updated {new Date(todayAttendance.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-slate-600">Attendance not yet marked for today.</p>
              )}
              {attOverall.total_school_days === 0 ? (
                <p className="text-sm text-slate-600">No attendance recorded yet.</p>
              ) : (
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-emerald-50 py-2">
                    <dt className="text-xs text-emerald-800">Present</dt>
                    <dd className="text-xl font-semibold tabular text-emerald-900">{attPresent}</dd>
                  </div>
                  <div className="rounded-xl bg-amber-50 py-2">
                    <dt className="text-xs text-amber-800">Late</dt>
                    <dd className="text-xl font-semibold tabular text-amber-900">{attLate}</dd>
                  </div>
                  <div className="rounded-xl bg-rose-50 py-2">
                    <dt className="text-xs text-rose-800">Absent</dt>
                    <dd className="text-xl font-semibold tabular text-rose-900">{attAbsent}</dd>
                  </div>
                </dl>
              )}
            </div>
          </Link>

          {/* Grades */}
          <Link href="/student/grades" className="student-card student-card--manila group block px-6 py-5">
            <p className="text-sm font-semibold text-slate-700">Report card, {currentTerm?.name ?? 'current term'}</p>
            <p className="text-2xl font-semibold mt-1">My grades</p>
            <p className="text-sm text-slate-700 mt-1">View assessment results and scores.</p>
          </Link>
        </div>
      </div>

      {/* What's new for you */}
      {_uRow && (
        <section>
          <h2 className="text-xl font-semibold mb-4">What&apos;s new for you</h2>
          <DashboardFeed userId={_uRow.id} role="STUDENT" />
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
