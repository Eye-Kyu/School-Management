import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { todayEnum, formatTime, DAY_LABELS, type Day } from '@/lib/utils/days';

export default async function StudentHomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const today = todayEnum() as Day;

  const { data: student } = await supabase
    .from('students')
    .select('id, current_class_id, user:users!inner(full_name)')
    .eq('users.auth_id', user.id)
    .maybeSingle();

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

  // Attendance summary
  const { data: attendanceRecords } = studentId && currentTerm
    ? await supabase
        .from('attendance_records')
        .select('status')
        .eq('student_id', studentId)
        .gte('date', currentTerm.start_date)
        .lte('date', currentTerm.end_date)
    : { data: [] };

  const attTotal = (attendanceRecords ?? []).length;
  const attPresent = (attendanceRecords ?? []).filter((r) => r.status === 'PRESENT').length;
  const attLate = (attendanceRecords ?? []).filter((r) => r.status === 'LATE').length;
  const attAbsent = (attendanceRecords ?? []).filter((r) => r.status === 'ABSENT').length;
  const attRate = attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 100) : null;

  // Announcements
  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, title, body, published_at')
    .order('published_at', { ascending: false })
    .limit(3);

  const firstName = (student?.user as any)?.full_name?.split(' ')[0] ?? 'Student';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">
          Good {greeting()}, {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {DAY_LABELS[today]} · {(todaySlots ?? []).length} classes today
        </p>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Today's classes card */}
        <Link href="/student/timetable" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-blue-100 text-xs font-medium uppercase tracking-wide">Today's Classes</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-4xl font-bold text-white">{(todaySlots ?? []).length}</p>
              <p className="text-blue-100 text-sm mt-1">{DAY_LABELS[today]}</p>
            </div>
            <div className="bg-white px-5 py-3 space-y-1.5">
              {(todaySlots ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No classes scheduled today.</p>
              ) : (
                (todaySlots ?? []).slice(0, 3).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <span className="text-slate-400 text-xs w-16 shrink-0">{formatTime(s.start_time)}</span>
                    <span className="font-medium text-slate-700 truncate">{s.subject?.name}</span>
                  </div>
                ))
              )}
              {(todaySlots ?? []).length > 3 && (
                <p className="text-xs text-slate-400">+{(todaySlots ?? []).length - 3} more</p>
              )}
            </div>
          </div>
        </Link>

        {/* Grades card */}
        <Link href="/student/grades" className="block group">
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-violet-500 to-purple-600 px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-violet-100 text-xs font-medium uppercase tracking-wide">My Grades</span>
                <span className="text-white/60 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-4xl font-bold text-white">%</p>
              <p className="text-violet-100 text-sm mt-1">{currentTerm?.name ?? 'current term'}</p>
            </div>
            <div className="bg-white px-5 py-3">
              <p className="text-sm text-slate-600">View assessment results and scores.</p>
            </div>
          </div>
        </Link>

        {/* Attendance card */}
        <Link href="/student/attendance" className="block group">
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
              <p className="text-white/80 text-sm mt-1">
                {currentTerm?.name ?? 'current term'}
              </p>
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
      </div>

      {/* Announcements */}
      {(announcements ?? []).length > 0 && (
        <section>
          <h2 className="text-base font-medium mb-3">Announcements</h2>
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
