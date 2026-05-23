import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import AttendanceClient from './AttendanceClient';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default async function TeacherAttendancePage({
  searchParams,
}: {
  searchParams: { classId?: string; date?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const date = searchParams.date ?? todayIso();
  const selectedClassId = searchParams.classId ?? '';

  // Fetch classes this teacher is assigned to via subject_assignments
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, user:users!inner(auth_id)')
    .eq('users.auth_id', user.id)
    .maybeSingle();

  const { data: assignments } = teacher
    ? await supabase
        .from('subject_assignments')
        .select('class:classes!inner(id, name, grade_level)')
        .eq('teacher_id', teacher.id)
    : { data: [] };

  // Deduplicate classes
  const seen = new Set<string>();
  const classes = (assignments ?? [])
    .map((a: any) => a.class)
    .filter((c: any) => c && !seen.has(c.id) && seen.add(c.id))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  // Fetch roster + existing attendance for the selected class
  let roster: Array<{
    id: string;
    admissionNo: string;
    fullName: string;
    attendance: { status: string; note: string | null } | null;
  }> = [];

  if (selectedClassId) {
    const [{ data: students }, { data: records }] = await Promise.all([
      supabase
        .from('students')
        .select('id, admission_no, user:users!inner(full_name)')
        .eq('current_class_id', selectedClassId)
        .eq('is_active', true)
        .order('admission_no'),
      supabase
        .from('attendance_records')
        .select('student_id, status, note')
        .eq('class_id', selectedClassId)
        .eq('date', date),
    ]);

    const statusMap = Object.fromEntries(
      (records ?? []).map((r) => [r.student_id, { status: r.status, note: r.note }]),
    );

    roster = (students ?? []).map((s: any) => ({
      id: s.id,
      admissionNo: s.admission_no,
      fullName: s.user?.full_name ?? '',
      attendance: statusMap[s.id] ?? null,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Mark attendance</h1>
          <p className="text-sm text-slate-500 mt-0.5">Select a class and date to mark or update attendance.</p>
        </div>
      </div>

      <AttendanceClient
        classes={classes}
        selectedClassId={selectedClassId}
        date={date}
        roster={roster}
      />
    </div>
  );
}
