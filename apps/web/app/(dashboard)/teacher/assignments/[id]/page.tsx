import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import BackButton from '@/components/BackButton';
import SubmissionsClient from './SubmissionsClient';
import AttachedDocumentsSection from '@/components/documents/AttachedDocumentsSection';

export default async function AssignmentDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: assignment } = await supabase
    .from('assignments')
    .select('id, title, description, due_date, max_score, created_by_id, class:classes(id, name), subject:subjects(name), term:terms(name)')
    .eq('id', params.id)
    .maybeSingle();

  if (!assignment) notFound();

  const { data: userRow } = user
    ? await supabase.from('users').select('id, role').eq('auth_id', user.id).maybeSingle()
    : { data: null };
  const canManage = userRow?.role === 'ADMIN' || userRow?.id === assignment.created_by_id;

  const classId = (assignment.class as any)?.id;

  const [{ data: students }, { data: submissions }] = await Promise.all([
    supabase
      .from('students')
      .select('id, user:users!user_id(full_name)')
      .eq('current_class_id', classId ?? '')
      .eq('is_active', true)
      .order('id'),
    supabase
      .from('submissions')
      .select('id, student_id, content, file_urls, submitted_at, is_late, grade_score, grade_comment, graded_at')
      .eq('assignment_id', params.id),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher/assignments" />
        <div>
          <h1 className="text-2xl font-semibold">{assignment.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {(assignment.class as any)?.name}
            {(assignment.subject as any)?.name ? ` · ${(assignment.subject as any).name}` : ''}
            {' · Due '}{new Date(assignment.due_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {assignment.description && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 text-sm text-slate-700 whitespace-pre-wrap">
          {assignment.description}
        </div>
      )}

      <SubmissionsClient
        assignmentId={params.id}
        maxScore={assignment.max_score as number | null}
        students={(students ?? []) as any[]}
        submissions={(submissions ?? []) as any[]}
      />

      <AttachedDocumentsSection scopeSubtype="ONLINE_ASSIGNMENT" scopeId={params.id} canManage={canManage} />
    </div>
  );
}
