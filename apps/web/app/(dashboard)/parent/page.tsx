import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, type Day } from '@/lib/utils/days';
import UpcomingEvents from '@/components/UpcomingEvents';
import RoleBadgeList from '@/components/RoleBadgeList';
import type { RoleBadge } from '@/lib/roleBadges';
import { DashboardFeed } from '@/components/DashboardFeed/DashboardFeed';
import { fetchAttendanceData } from '@/lib/attendance/fetchAttendanceData';
import { calculateAttendanceRate } from '@school-manager/types';

export default async function ParentHomePage() {
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
        .select('student:students!inner(id, admission_no, current_class_id, user:users!inner(full_name))')
        .eq('user_id', userRow.id)
    : { data: [] };

  const students = (guardianLinks ?? []).map((g: any) => g.student).filter(Boolean);
  const firstStudent = students[0];
  const classId = firstStudent?.current_class_id;

  // Today's timetable for first child
  const { data: todaySlots } = classId
    ? await supabase
        .from('timetable_slots')
        .select('id, start_time, end_time, room, subject:subjects(name), teacher:teachers!inner(user:users!inner(full_name))')
        .eq('class_id', classId)
        .eq('day_of_week', today)
        .order('start_time')
    : { data: [] };

  // Current term + attendance for first child
  const { data: currentTerm } = await supabase
    .from('terms')
    .select('id, name, start_date, end_date')
    .eq('is_current', true)
    .maybeSingle();

  const todayDate = new Date().toISOString().slice(0, 10);
  // A term whose date range doesn't cover today (ended, or the next one
  // hasn't been marked current yet) must never filter out today's record.
  const termCoversToday = !!currentTerm && todayDate >= currentTerm.start_date && todayDate <= currentTerm.end_date;

  // A non-submitting guardian has no RLS path to absence_requests directly
  // (see docs/audits/shared-helpers-call-sites.md §1.3), so the
  // approved-absence overlay comes from the approved-absences endpoint.
  const attendanceRange = termCoversToday
    ? { startDate: currentTerm!.start_date, endDate: currentTerm!.end_date }
    : { startDate: '2000-01-01', endDate: todayDate };
  const attendanceInput = firstStudent
    ? await fetchAttendanceData(supabase, firstStudent.id, attendanceRange)
    : { records: [], approvedAbsences: [] };

  const attPresent = attendanceInput.records.filter((r) => r.status === 'PRESENT').length;
  const attLate = attendanceInput.records.filter((r) => r.status === 'LATE').length;
  const attAbsent = attendanceInput.records.filter((r) => r.status === 'ABSENT').length;
  const attOverall = calculateAttendanceRate(attendanceInput);
  const attTotal = attOverall.total_school_days;
  const attRate = attTotal > 0 ? Math.round(attOverall.attendance_rate) : null;

  // Fee balances for all linked students
  const studentIds = students.map((s: any) => s.id);

  // Today's status per child — always queried by exact date, never
  // term-range filtered, so it can never be silently excluded by
  // term-boundary staleness. Used for the per-child attendance cards below.
  const { data: todayAttendanceRows } = studentIds.length > 0
    ? await supabase
        .from('attendance_records')
        .select('student_id, status, updated_at')
        .in('student_id', studentIds)
        .eq('date', todayDate)
    : { data: [] };
  const todayByStudent = new Map((todayAttendanceRows ?? []).map((r: any) => [r.student_id, r]));

  // Prefect badges per linked child, for the summary cards below.
  const [{ data: classPrefectRows }, { data: schoolPrefectRows }] = studentIds.length > 0
    ? await Promise.all([
        supabase.from('class_prefects').select('student_id, class:classes!inner(name)').in('student_id', studentIds).is('revoked_at', null),
        supabase.from('school_prefects').select('student_id, role_title').in('student_id', studentIds).is('revoked_at', null),
      ])
    : [{ data: [] }, { data: [] }];
  const prefectBadgesByStudent = new Map<string, RoleBadge[]>();
  for (const r of (classPrefectRows ?? []) as any[]) {
    const className = r.class?.name;
    if (!className) continue;
    const arr = prefectBadgesByStudent.get(r.student_id) ?? [];
    arr.push({ variant: 'classPrefect', label: `Class Prefect: ${className}`, href: '/prefect-role-info' });
    prefectBadgesByStudent.set(r.student_id, arr);
  }
  for (const r of (schoolPrefectRows ?? []) as any[]) {
    const arr = prefectBadgesByStudent.get(r.student_id) ?? [];
    arr.push({ variant: 'schoolPrefect', label: r.role_title, href: '/prefect-role-info' });
    prefectBadgesByStudent.set(r.student_id, arr);
  }
  const { data: feeBalances } = studentIds.length > 0
    ? await supabase
        .from('fee_balances')
        .select('id, amount_due, amount_paid, currency, notes, term:terms(name)')
        .in('student_id', studentIds)
        .order('created_at', { ascending: false })
    : { data: [] };

  const totalOutstanding = (feeBalances ?? []).reduce(
    (s, b) => s + Number((b as any).amount_due) - Number((b as any).amount_paid),
    0,
  );
  const currency = (feeBalances ?? [])[0] ? (feeBalances as any[])[0].currency : 'KES';

  const now = new Date().toISOString();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id, title, starts_at, ends_at, all_day, event_type')
    .gte('starts_at', now)
    .lte('starts_at', in30Days)
    .order('starts_at')
    .limit(10);

  const firstName = userRow?.full_name?.split(' ')[0] ?? 'Parent';
  const childFirstName = (firstStudent?.user as any)?.full_name?.split(' ')[0];

  const slots = (todaySlots ?? []) as any[];
  const statusPill = (status: string) =>
    status === 'PRESENT' ? 'bg-emerald-100 text-emerald-800'
    : status === 'LATE' ? 'bg-amber-100 text-amber-800'
    : status === 'ABSENT' ? 'bg-rose-100 text-rose-800'
    : 'bg-slate-100 text-slate-700';
  const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase();
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Good {greeting()}, {firstName}
        </h1>
        <p className="text-base text-slate-600 mt-2">
          {students.length > 0
            ? `${students.length} child${students.length > 1 ? 'ren' : ''} linked`
            : 'No students linked to your account yet'}
        </p>
        {students.length === 1 && (prefectBadgesByStudent.get(firstStudent.id) ?? []).length > 0 && (
          <RoleBadgeList badges={prefectBadgesByStudent.get(firstStudent.id) ?? []} className="mt-3" />
        )}
      </header>

      {students.length === 0 ? (
        <div className="ruled-page max-w-xl">
          <p className="font-semibold">Ask your school admin to link your child&apos;s account.</p>
        </div>
      ) : (
        <>
          {/* Multiple children: one folder each, side by side */}
          {students.length > 1 && (
            <section aria-labelledby="children-heading">
              <h2 id="children-heading" className="text-lg font-semibold mb-4">Attendance</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {students.map((s: any) => {
                  const todayRow = todayByStudent.get(s.id) as { status: string; updated_at: string } | undefined;
                  const childBadges = prefectBadgesByStudent.get(s.id) ?? [];
                  return (
                    <div key={s.id} className="folder">
                      <Link href="/parent/attendance" className="folder-link">
                        <span className="folder-tab truncate">{(s.user as any)?.full_name}</span>
                        {todayRow ? (
                          <span className="flex flex-wrap items-center gap-2 text-sm mt-3">
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusPill(todayRow.status)}`}>
                              {statusLabel(todayRow.status)} today
                            </span>
                            <span className="text-slate-500 text-xs">updated {timeOf(todayRow.updated_at)}</span>
                          </span>
                        ) : (
                          <span className="block text-sm text-slate-600 mt-3">Not yet marked for today.</span>
                        )}
                      </Link>
                      {childBadges.length > 0 && <RoleBadgeList badges={childBadges} className="mt-3" />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {/* The child's school day, as the timetable reads */}
            <section aria-labelledby="classes-heading">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 id="classes-heading" className="text-lg font-semibold">
                  {childFirstName ? `${childFirstName}'s classes today` : "Today's classes"}
                </h2>
                <Link href="/parent/timetable" className="link text-sm font-semibold">Timetable</Link>
              </div>
              <div className="sheet overflow-hidden">
                <p className="px-5 py-3 text-sm text-slate-600 border-b border-slate-200">{DAY_LABELS[today]}</p>
                {slots.length === 0 ? (
                  <p className="px-5 py-8 text-sm text-slate-600">No classes today.</p>
                ) : (
                  <ol>
                    {slots.map((s) => (
                      <li key={s.id} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 px-5 py-3 border-b border-slate-100 last:border-b-0">
                        <span className="text-sm text-slate-600 tabular">{formatTime(s.start_time)}</span>
                        <span className="min-w-0">
                          <span className="block font-semibold truncate">{s.subject?.name}</span>
                          {s.teacher?.user?.full_name && (
                            <span className="block text-sm text-slate-600 truncate">{s.teacher.user.full_name}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>

            <div className="space-y-4">
              {/* Fee statement: the figure parents look for first */}
              <Link href="/parent/fees" className="statement">
                <span className="text-sm font-semibold text-slate-600">Fee balance</span>
                <span className={`block text-4xl font-semibold tracking-tight tabular mt-1 ${totalOutstanding > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {currency} {totalOutstanding.toLocaleString()}
                </span>
                <span className="block text-sm text-slate-700 mt-1">
                  {totalOutstanding > 0 ? 'outstanding balance' : 'all fees paid'}
                </span>
                <span className="block text-sm text-slate-500 mt-3 pt-3 border-t border-slate-200">
                  {(feeBalances ?? []).length === 0
                    ? 'No fee records yet.'
                    : `${(feeBalances ?? []).length} balance record${(feeBalances ?? []).length !== 1 ? 's' : ''} on file`}
                </span>
              </Link>

              {/* Attendance, for a single linked child */}
              {students.length === 1 && (
                <Link href="/parent/attendance" className="statement">
                  <span className="text-sm font-semibold text-slate-600">Attendance, {currentTerm?.name ?? 'current term'}</span>
                  <span className="block text-4xl font-semibold tracking-tight tabular mt-1">
                    {attRate !== null ? `${attRate}%` : '—'}
                  </span>
                  {(() => {
                    const todayRow = todayByStudent.get(firstStudent.id) as { status: string; updated_at: string } | undefined;
                    return todayRow ? (
                      <span className="flex flex-wrap items-center gap-2 text-sm mt-2">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusPill(todayRow.status)}`}>
                          {statusLabel(todayRow.status)} today
                        </span>
                        <span className="text-slate-500 text-xs">updated {timeOf(todayRow.updated_at)}</span>
                      </span>
                    ) : (
                      <span className="block text-sm text-slate-600 mt-2">Attendance not yet marked for today.</span>
                    );
                  })()}
                  {attTotal === 0 ? (
                    <span className="block text-sm text-slate-600 mt-3 pt-3 border-t border-slate-200">No attendance recorded yet.</span>
                  ) : (
                    <span className="flex gap-5 text-sm mt-3 pt-3 border-t border-slate-200 tabular">
                      <span className="text-emerald-800 font-semibold">{attPresent} present</span>
                      <span className="text-amber-800 font-semibold">{attLate} late</span>
                      <span className="text-rose-800 font-semibold">{attAbsent} absent</span>
                    </span>
                  )}
                </Link>
              )}

              {/* Report card */}
              <Link href="/parent/grades" className="statement statement--manila">
                <span className="text-sm font-semibold text-slate-700">Report card, {currentTerm?.name ?? 'current term'}</span>
                <span className="block text-xl font-semibold mt-1">
                  {childFirstName ? `${childFirstName}'s grades` : 'Grades'}
                </span>
                <span className="block text-sm text-slate-700 mt-1">View assessment results and marks.</span>
              </Link>
            </div>
          </div>
        </>
      )}

      {/* What's new for you */}
      {userRow && (
        <section>
          <h2 className="text-lg font-semibold mb-4">What&apos;s new for you</h2>
          <DashboardFeed userId={userRow.id} role="PARENT" />
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
