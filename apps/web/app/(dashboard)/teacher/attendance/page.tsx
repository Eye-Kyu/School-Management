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

  // Resolve user row, then look up teacher record
  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();

  const { data: teacher } = userRow
    ? await supabase
        .from('teachers')
        .select('id, is_class_teacher_of')
        .eq('user_id', userRow.id)
        .maybeSingle()
    : { data: null };

  const [{ data: assignments }, { data: classTeacherClass }] = teacher
    ? await Promise.all([
        supabase
          .from('subject_assignments')
          .select('class:classes!inner(id, name, grade_level)')
          .eq('teacher_id', teacher.id),
        teacher.is_class_teacher_of
          ? supabase.from('classes').select('id, name, grade_level').eq('id', teacher.is_class_teacher_of).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
    : [{ data: [] }, { data: null }];

  // Deduplicate classes — a pure Class Teacher with no subject_assignments
  // still needs their own class in this list, not just subject-taught ones.
  const seen = new Set<string>();
  const classes = [...(assignments ?? []).map((a: any) => a.class), classTeacherClass]
    .filter((c: any) => c && !seen.has(c.id) && seen.add(c.id))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  const isClassTeacher = !!(teacher?.is_class_teacher_of && teacher.is_class_teacher_of === selectedClassId);

  // Fetch roster + existing attendance + current prefect for the selected class
  let roster: Array<{
    id: string;
    admissionNo: string;
    fullName: string;
    attendance: { status: string; note: string | null } | null;
    excusedByAbsenceRequest: boolean;
  }> = [];
  let currentPrefect: { id: string; studentId: string; fullName: string } | null = null;

  if (selectedClassId) {
    const [{ data: students }, { data: records }, { data: prefectRow }] = await Promise.all([
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
      supabase
        .from('class_prefects')
        .select('id, student_id, student:students!inner(user:users!inner(full_name))')
        .eq('class_id', selectedClassId)
        .is('revoked_at', null)
        .maybeSingle(),
    ]);

    currentPrefect = prefectRow
      ? { id: prefectRow.id, studentId: prefectRow.student_id, fullName: (prefectRow as any).student?.user?.full_name ?? '' }
      : null;

    const statusMap = Object.fromEntries(
      (records ?? []).map((r) => [r.student_id, { status: r.status, note: r.note }]),
    );

    // Days covered by an approved absence request are auto-EXCUSED and
    // non-editable here — no attendance_records row is written for them,
    // the status is computed at read time, same as AttendanceService.roster().
    const studentIds = (students ?? []).map((s: any) => s.id);
    const excusedIds = new Set<string>();
    if (studentIds.length > 0) {
      const { data: absences } = await supabase
        .from('absence_requests')
        .select('student_id')
        .in('student_id', studentIds)
        .eq('status', 'APPROVED')
        .lte('start_date', date)
        .gte('end_date', date);
      for (const a of absences ?? []) excusedIds.add(a.student_id);
    }

    roster = (students ?? []).map((s: any) => ({
      id: s.id,
      admissionNo: s.admission_no,
      fullName: s.user?.full_name ?? '',
      attendance: statusMap[s.id] ?? (excusedIds.has(s.id) ? { status: 'EXCUSED', note: 'Approved absence' } : null),
      excusedByAbsenceRequest: excusedIds.has(s.id),
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
        isClassTeacher={isClassTeacher}
        currentPrefect={currentPrefect}
      />
    </div>
  );
}
