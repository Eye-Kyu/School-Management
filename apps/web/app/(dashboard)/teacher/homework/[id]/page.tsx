import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import HomeworkGradingClient from './HomeworkGradingClient';
import AttachedDocumentsSection from '@/components/documents/AttachedDocumentsSection';
import { notFound } from 'next/navigation';

export default async function HomeworkGradingPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase.from('users').select('id, role').eq('auth_id', user.id).maybeSingle();

  const { data: homework } = await supabase
    .from('homework_assignments')
    .select('id, title, max_score, teacher_id, class:classes(name), subject:subjects(name)')
    .eq('id', params.id)
    .maybeSingle();

  if (!homework) return notFound();

  let canManage = userRow?.role === 'ADMIN';
  if (!canManage && userRow?.role === 'TEACHER') {
    const { data: teacherRow } = await supabase.from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
    canManage = teacherRow?.id === homework.teacher_id;
  }

  const { data: completions } = await supabase
    .from('homework_completions')
    .select('id, completed_at, score, grader_note, student:students(id, admission_no, user:users!inner(full_name))')
    .eq('homework_id', params.id)
    .order('completed_at', { ascending: true });

  const submissions = (completions ?? []).map((c: any) => ({
    id: c.id as string,
    admissionNo: c.student?.admission_no as string ?? '',
    fullName: c.student?.user?.full_name as string ?? '',
    completedAt: c.completed_at as string,
    score: c.score as number | null,
    graderNote: c.grader_note as string | null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher/homework" />
        <div>
          <h1 className="text-2xl font-semibold">{homework.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {(homework.subject as any)?.name ?? 'No subject'} · {(homework.class as any)?.name}
            {homework.max_score != null ? ` · out of ${homework.max_score}` : ''}
          </p>
        </div>
      </div>

      <HomeworkGradingClient
        homeworkId={params.id}
        maxScore={homework.max_score}
        submissions={submissions}
      />

      <AttachedDocumentsSection scopeSubtype="HOMEWORK" scopeId={params.id} canManage={canManage} />
    </div>
  );
}
