import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, type Day } from '@/lib/utils/days';

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

  const { data: attendanceRecords } = firstStudent && currentTerm
    ? await supabase
        .from('attendance_records')
        .select('status')
        .eq('student_id', firstStudent.id)
        .gte('date', currentTerm.start_date)
        .lte('date', currentTerm.end_date)
    : { data: [] };

  const attTotal = (attendanceRecords ?? []).length;
  const attPresent = (attendanceRecords ?? []).filter((r) => r.status === 'PRESENT').length;
  const attLate = (attendanceRecords ?? []).filter((r) => r.status === 'LATE').length;
  const attAbsent = (attendanceRecords ?? []).filter((r) => r.status === 'ABSENT').length;
  const attRate = attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 100) : null;

  // Fee balances for all linked students
  const studentIds = students.map((s: any) => s.id);
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
    .order('published_at', { ascending: false })
    .limit(3);

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
      </div>

      {students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-400">
          Ask your school admin to link your child's account.
        </div>
      ) : (
        <>
          {/* Multiple children pills */}
          {students.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {students.map((s: any) => (
                <span key={s.id}
                  className="text-sm bg-violet-100 text-violet-700 rounded-full px-3 py-1 font-medium">
                  {(s.user as any)?.full_name}
                </span>
              ))}
            </div>
          )}

          {/* Cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Today's classes card */}
            <Link href="/parent/timetable" className="block group">
              <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-blue-100 text-xs font-medium uppercase tracking-wide">
                      {childFirstName ? `${childFirstName}'s Classes Today` : "Today's Classes"}
                    </span>
                    <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
                  </div>
                  <p className="text-4xl font-bold text-white">{(todaySlots ?? []).length}</p>
                  <p className="text-blue-100 text-sm mt-1">{DAY_LABELS[today]}</p>
                </div>
                <div className="bg-white px-5 py-3 space-y-1.5">
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

            {/* Attendance card */}
            <Link href="/parent/attendance" className="block group">
              <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className={`px-5 py-4 bg-gradient-to-br ${
                  attRate === null ? 'from-slate-400 to-slate-500'
                  : attRate >= 80 ? 'from-emerald-500 to-teal-600'
                  : attRate >= 60 ? 'from-amber-500 to-orange-600'
                  : 'from-rose-500 to-red-600'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/80 text-xs font-medium uppercase tracking-wide">Attendance</span>
                    <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
                  </div>
                  <p className="text-4xl font-bold text-white">
                    {attRate !== null ? `${attRate}%` : '—'}
                  </p>
                  <p className="text-white/80 text-sm mt-1">{currentTerm?.name ?? 'current term'}</p>
                </div>
                <div className="bg-white px-5 py-3">
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

            {/* Fee balance card */}
            <Link href="/parent/fees" className="block group">
              <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className={`px-5 py-4 bg-gradient-to-br ${
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
                <div className="bg-white px-5 py-3">
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
                <div className="bg-gradient-to-br from-violet-500 to-purple-600 px-5 py-4">
                  <span className="text-violet-100 text-xs font-medium uppercase tracking-wide">Announcements</span>
                  <p className="text-4xl font-bold text-white mt-2">{(announcements ?? []).length}</p>
                  <p className="text-violet-100 text-sm mt-1">recent notices</p>
                </div>
                <div className="bg-white px-5 py-3 space-y-2">
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
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
