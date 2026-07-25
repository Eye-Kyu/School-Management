import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, type Day } from '@/lib/utils/days';
import UpcomingEvents from '@/components/UpcomingEvents';
import RoleBadgeList from '@/components/RoleBadgeList';
import type { RoleBadge } from '@/lib/roleBadges';

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

  const parentAttQuery = firstStudent
    ? supabase.from('attendance_records').select('status').eq('student_id', firstStudent.id)
    : null;
  const { data: attendanceRecords } = parentAttQuery
    ? termCoversToday
      ? await parentAttQuery.gte('date', currentTerm!.start_date).lte('date', currentTerm!.end_date)
      : await parentAttQuery
    : { data: [] };

  const attTotal = (attendanceRecords ?? []).length;
  const attPresent = (attendanceRecords ?? []).filter((r) => r.status === 'PRESENT').length;
  const attLate = (attendanceRecords ?? []).filter((r) => r.status === 'LATE').length;
  const attAbsent = (attendanceRecords ?? []).filter((r) => r.status === 'ABSENT').length;
  const attRate = attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 100) : null;

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

  // Announcements
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

  const firstName = userRow?.full_name?.split(' ')[0] ?? 'Parent';
  const childFirstName = (firstStudent?.user as any)?.full_name?.split(' ')[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">
          Good {greeting()}, {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {students.length > 0
            ? `${students.length} child${students.length > 1 ? 'ren' : ''} linked`
            : 'No students linked to your account yet'}
        </p>
        {students.length === 1 && (prefectBadgesByStudent.get(firstStudent.id) ?? []).length > 0 && (
          <RoleBadgeList badges={prefectBadgesByStudent.get(firstStudent.id) ?? []} className="mt-2" />
        )}
      </div>

      {students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-400">
          Ask your school admin to link your child's account.
        </div>
      ) : (
        <>
          {/* Multiple children: compact per-child attendance cards, side by side */}
          {students.length > 1 && (
            <div>
              <h2 className="text-base font-medium mb-3">Attendance</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {students.map((s: any) => {
                  const todayRow = todayByStudent.get(s.id) as { status: string; updated_at: string } | undefined;
                  const childBadges = prefectBadgesByStudent.get(s.id) ?? [];
                  return (
                    <div key={s.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3 shadow-sm hover:shadow-md transition-shadow">
                      <Link href="/parent/attendance" className="block group">
                        <p className="font-medium text-sm text-slate-700 truncate">{(s.user as any)?.full_name}</p>
                        {todayRow ? (
                          <p className="text-sm mt-1.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              todayRow.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700'
                              : todayRow.status === 'LATE' ? 'bg-amber-100 text-amber-700'
                              : todayRow.status === 'ABSENT' ? 'bg-rose-100 text-rose-700'
                              : 'bg-slate-100 text-slate-600'
                            }`}>
                              {todayRow.status.charAt(0) + todayRow.status.slice(1).toLowerCase()} today
                            </span>
                            <span className="text-slate-400 text-xs ml-2">
                              updated {new Date(todayRow.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </p>
                        ) : (
                          <p className="text-sm text-slate-400 mt-1.5">Not yet marked for today.</p>
                        )}
                      </Link>
                      {childBadges.length > 0 && <RoleBadgeList badges={childBadges} className="mt-2" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cards grid */}
          <div className="grid grid-cols-2 gap-4">

            {/* Today's classes card */}
            <Link href="/parent/timetable" className="block group">
              <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 px-3 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-blue-100 text-xs font-medium uppercase tracking-wide">
                      {childFirstName ? `${childFirstName}'s Classes Today` : "Today's Classes"}
                    </span>
                    <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
                  </div>
                  <p className="text-3xl sm:text-4xl font-bold text-white">{(todaySlots ?? []).length}</p>
                  <p className="text-blue-100 text-sm mt-1">{DAY_LABELS[today]}</p>
                </div>
                <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3 space-y-1.5">
                  {(todaySlots ?? []).length === 0 ? (
                    <p className="text-sm text-slate-400">No classes today.</p>
                  ) : (
                    (todaySlots ?? []).slice(0, 3).map((s: any) => (
                      <div key={s.id} className="flex items-center gap-3 text-sm">
                        <span className="text-slate-400 text-xs w-16 shrink-0">{formatTime(s.start_time)}</span>
                        <span className="font-medium text-slate-700 truncate">{s.subject?.name}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Link>

            {/* Attendance card — only for a single linked child; multiple
                children get the compact per-child cards above instead. */}
            {students.length === 1 && (
              <Link href="/parent/attendance" className="block group">
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
                    <p className="text-white/80 text-sm mt-1">{currentTerm?.name ?? 'current term'}</p>
                  </div>
                  <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3 space-y-2">
                    {(() => {
                      const todayRow = todayByStudent.get(firstStudent.id) as { status: string; updated_at: string } | undefined;
                      return todayRow ? (
                        <p className="text-sm">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            todayRow.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700'
                            : todayRow.status === 'LATE' ? 'bg-amber-100 text-amber-700'
                            : todayRow.status === 'ABSENT' ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                          }`}>
                            {todayRow.status.charAt(0) + todayRow.status.slice(1).toLowerCase()} today
                          </span>
                          <span className="text-slate-400 text-xs ml-2">
                            updated {new Date(todayRow.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </p>
                      ) : (
                        <p className="text-sm text-slate-400">Attendance not yet marked for today.</p>
                      );
                    })()}
                    {attTotal === 0 ? (
                      <p className="text-sm text-slate-400">No attendance recorded yet.</p>
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
            )}

            {/* Grades card */}
            <Link href="/parent/grades" className="block group">
              <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="bg-gradient-to-br from-violet-500 to-purple-600 px-3 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-violet-100 text-xs font-medium uppercase tracking-wide">
                      {childFirstName ? `${childFirstName}'s Grades` : 'Grades'}
                    </span>
                    <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
                  </div>
                  <p className="text-3xl sm:text-4xl font-bold text-white">%</p>
                  <p className="text-violet-100 text-sm mt-1">{currentTerm?.name ?? 'current term'}</p>
                </div>
                <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3">
                  <p className="text-sm text-slate-600">View assessment results and marks.</p>
                </div>
              </div>
            </Link>

            {/* Fee balance card */}
            <Link href="/parent/fees" className="block group">
              <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className={`px-3 py-3 sm:px-5 sm:py-4 bg-gradient-to-br ${
                  totalOutstanding > 0 ? 'from-amber-500 to-orange-600' : 'from-emerald-500 to-teal-600'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/80 text-xs font-medium uppercase tracking-wide">Fee Balance</span>
                    <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
                  </div>
                  <p className="text-3xl font-bold text-white">
                    {currency} {totalOutstanding.toLocaleString()}
                  </p>
                  <p className="text-white/80 text-sm mt-1">
                    {totalOutstanding > 0 ? 'outstanding balance' : 'all fees paid'}
                  </p>
                </div>
                <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3">
                  {(feeBalances ?? []).length === 0 ? (
                    <p className="text-sm text-slate-400">No fee records yet.</p>
                  ) : (
                    <p className="text-sm text-slate-600">
                      {(feeBalances ?? []).length} balance record{(feeBalances ?? []).length !== 1 ? 's' : ''} on file
                    </p>
                  )}
                </div>
              </div>
            </Link>

            {/* Announcements card */}
            {(announcements ?? []).length > 0 && (
              <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm">
                <div className="bg-gradient-to-br from-violet-500 to-purple-600 px-3 py-3 sm:px-5 sm:py-4">
                  <span className="text-violet-100 text-xs font-medium uppercase tracking-wide">Announcements</span>
                  <p className="text-3xl sm:text-4xl font-bold text-white mt-2">{(announcements ?? []).length}</p>
                  <p className="text-violet-100 text-sm mt-1">recent notices</p>
                </div>
                <div className="bg-white px-3 py-2.5 sm:px-5 sm:py-3 space-y-2">
                  {(announcements ?? []).slice(0, 2).map((a: any) => (
                    <div key={a.id}>
                      <p className="text-sm font-medium text-slate-700 truncate">{a.title}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(a.published_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <UpcomingEvents events={(events ?? []) as any[]} />
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
