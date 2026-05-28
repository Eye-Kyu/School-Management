import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import StudentAssignmentsClient from './StudentAssignmentsClient';

export default async function StudentAssignmentsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();

  const { data: student } = await supabase
    .from('students').select('id, current_class_id')
    .eq('user_id', userRow?.id ?? '').maybeSingle();

  const classId = student?.current_class_id;

  const [{ data: assignments }, { data: submissions }] = await Promise.all([
    classId
      ? supabase
          .from('assignments')
          .select('id, title, description, due_date, max_score, subject:subjects(name), term:terms(name)')
          .eq('class_id', classId)
          .order('due_date', { ascending: true })
      : { data: [] },
    student
      ? supabase
          .from('submissions')
          .select('id, assignment_id, submitted_at, is_late, grade_score, grade_comment, file_urls, content')
          .eq('student_id', student.id)
      : { data: [] },
  ]);

  const subMap = Object.fromEntries((submissions ?? []).map((s) => [s.assignment_id, s]));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/student" />
        <div>
          <h1 className="text-2xl font-semibold">Assignments</h1>
          <p className="text-sm text-slate-500 mt-0.5">View and submit your assignments.</p>
        </div>
      </div>
      <StudentAssignmentsClient
        assignments={(assignments ?? []) as any[]}
        submissionMap={subMap as any}
        studentId={student?.id ?? ''}
        schoolId={''}
      />
    </div>
  );
}
