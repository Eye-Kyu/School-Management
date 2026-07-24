import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import ClassesClient from './ClassesClient';

export default async function ClassesPage() {
  const supabase = createClient();
  const [{ data: classes }, { data: teachers }, { data: currentTerm }] = await Promise.all([
    supabase
      .from('classes')
      .select('id, name, grade_level, stream, is_active')
      .eq('is_active', true)
      .order('grade_level')
      .order('name'),
    supabase
      .from('teachers')
      .select('id, is_class_teacher_of, user:users!inner(full_name, is_active)')
      .eq('user.is_active', true),
    supabase.from('terms').select('id').eq('is_current', true).maybeSingle(),
  ]);

  // Best-effort, soft-warning signal for the confirmation dialog: which
  // currently-assigned class teachers still have unsigned (no class-teacher
  // comment) report cards for the current term.
  const classTeacherRows = (teachers ?? []).filter((t: any) => t.is_class_teacher_of);
  const classIdsWithTeachers = classTeacherRows.map((t: any) => t.is_class_teacher_of);
  let unsignedByTeacher = new Set<string>();
  if (currentTerm && classIdsWithTeachers.length > 0) {
    const { data: unsignedRows } = await supabase
      .from('student_report_cards')
      .select('student_id, students!inner(current_class_id)')
      .eq('term_id', currentTerm.id)
      .is('class_teacher_comment', null)
      .in('students.current_class_id', classIdsWithTeachers);
    const unsignedClassIds = new Set((unsignedRows ?? []).map((r: any) => r.students?.current_class_id).filter(Boolean));
    unsignedByTeacher = new Set(
      classTeacherRows
        .filter((t: any) => unsignedClassIds.has(t.is_class_teacher_of))
        .map((t: any) => t.id),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Classes</h1>
          <p className="text-sm text-slate-500 mt-0.5">{classes?.length ?? 0} active classes</p>
        </div>
      </div>
      <ClassesClient
        initialClasses={classes ?? []}
        teachers={(teachers ?? []).map((t: any) => ({ id: t.id, full_name: t.user?.full_name ?? '—', is_class_teacher_of: t.is_class_teacher_of }))}
        unsignedReportCardTeacherIds={Array.from(unsignedByTeacher)}
      />
    </div>
  );
}
