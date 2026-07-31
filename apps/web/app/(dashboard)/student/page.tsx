import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, type Day } from '@/lib/utils/days';
import UpcomingEvents from '@/components/UpcomingEvents';
import RoleBadgeList from '@/components/RoleBadgeList';
import { getMyRoleBadges } from '@/lib/roleBadges';
import PrefectPanel from './PrefectPanel';
import { DashboardFeed } from '@/components/DashboardFeed/DashboardFeed';

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
  const attQuery = studentId
    ? supabase.from('attendance_records').select('status').eq('student_id', studentId)
    : null;
  const { data: attendanceRecords } = attQuery
    ? termCoversToday
      ? await attQuery.gte('date', currentTerm!.start_date).lte('date', currentTerm!.end_date)
      : await attQuery
    : { data: [] };

  const attTotal = (attendanceRecords ?? []).length;
  const attPresent = (attendanceRecords ?? []).filter((r) => r.status === 'PRESENT').length;
  const attLate = (attendanceRecords ?? []).filter((r) => r.status === 'LATE').length;
  const attAbsent = (attendanceRecords ?? []).filter((r) => r.status === 'ABSENT').length;
  const attRate = attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 100) : null;

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

  return (
    <div className="space-y-8">
      <PrefectPanel />
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">
            Good {greeting()}, {firstName}
          </h1>
          {bestStudentAward && (
            <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1 text-xs font-semibold">
              🏆 Best Student — {currentTerm?.name}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 mt-1">
          {DAY_LABELS[today]} · {(todaySlots ?? []).length} classes today
        </p>
        {badges.length > 0 && <RoleBadgeList badges={badges} className="mt-2" />}
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-2 gap-4">

        {/* Today's classes card */}
        <Link href="/student/timetable" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-blue-100 text-xs font-medium uppercase tracking-wide">Today's Classes</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white">{(todaySlots ?? []).length}</p>
              <p className="text-blue-100 text-sm mt-1">{DAY_LABELS[today]}</p>
            </div>
            <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3 space-y-1.5">
              {(todaySlots ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No classes scheduled today.</p>
              ) : (
                (todaySlots ?? []).slice(0, 3).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <span className="text-slate-500 text-xs w-16 shrink-0">{formatTime(s.start_time)}</span>
                    <span className="font-medium text-slate-700 truncate">{s.subject?.name}</span>
                  </div>
                ))
              )}
              {(todaySlots ?? []).length > 3 && (
                <p className="text-xs text-slate-500">+{(todaySlots ?? []).length - 3} more</p>
              )}
            </div>
          </div>
        </Link>

        {/* Grades card */}
        <Link href="/student/grades" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-violet-500 to-purple-600 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-violet-100 text-xs font-medium uppercase tracking-wide">My Grades</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white">%</p>
              <p className="text-violet-100 text-sm mt-1">{currentTerm?.name ?? 'current term'}</p>
            </div>
            <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3">
              <p className="text-sm text-slate-600">View assessment results and scores.</p>
            </div>
          </div>
        </Link>

        {/* Attendance card */}
        <Link href="/student/attendance" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className={`px-3 py-3 sm:px-5 sm:py-4 bg-gradient-to-br ${
              attRate === null ? 'from-slate-400 to-slate-500'
              : attRate >= 80 ? 'from-emerald-500 to-teal-600'
              : attRate >= 60 ? 'from-amber-500 to-orange-600'
              : 'from-rose-500 to-red-600'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/80 text-xs font-medium uppercase tracking-wide">Attendance</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-3xl sm:text-4xl font-bold text-white">
                {attRate !== null ? `${attRate}%` : '—'}
              </p>
              <p className="text-white/80 text-sm mt-1">
                {currentTerm?.name ?? 'current term'}
              </p>
            </div>
            <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3 space-y-2">
              {todayAttendance ? (
                <p className="text-sm">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    todayAttendance.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700'
                    : todayAttendance.status === 'LATE' ? 'bg-amber-100 text-amber-700'
                    : todayAttendance.status === 'ABSENT' ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
                  }`}>
                    {todayAttendance.status.charAt(0) + todayAttendance.status.slice(1).toLowerCase()} today
                  </span>
                  <span className="text-slate-500 text-xs ml-2">
                    updated {new Date(todayAttendance.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-slate-500">Attendance not yet marked for today.</p>
              )}
              {attTotal === 0 ? (
                <p className="text-sm text-slate-500">No attendance recorded yet.</p>
              ) : (
                <div className="flex gap-4 text-sm">
                  <span className="text-emerald-600 font-medium">{attPresent} present</span>
                  <span className="text-amber-600 font-medium">{attLate} late</span>
                  <span className="text-rose-600 font-medium">{attAbsent} absent</span>
                </div>
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* What's new for you */}
      {_uRow && (
        <section>
          <h2 className="text-base font-medium mb-3">What&apos;s new for you</h2>
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
