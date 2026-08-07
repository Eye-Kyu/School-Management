import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import QuizzesTeacherClient from './QuizzesTeacherClient';

export default async function TeacherQuizzesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();

  const [{ data: quizzes }, { data: classes }, { data: subjects }, { data: terms }] = await Promise.all([
    supabase
      .from('quizzes')
      .select('id, title, is_published, time_limit_mins, created_at, closes_at, class_id, subject_id, class:classes(name), subject:subjects(name)')
      .eq('created_by_id', userRow?.id ?? '')
      .order('created_at', { ascending: false }),
    supabase.from('classes').select('id, name').eq('is_active', true).order('name'),
    supabase.from('subjects').select('id, name').order('name'),
    supabase.from('terms').select('id, name, is_current, start_date, end_date').order('start_date', { ascending: false }),
  ]);

  const quizIds = (quizzes ?? []).map((q) => q.id);
  const { data: links } = quizIds.length > 0
    ? await supabase.from('assessments').select('id, source_id').eq('source_type', 'QUIZ').in('source_id', quizIds)
    : { data: [] };
  const linkedByQuizId = Object.fromEntries((links ?? []).map((l) => [l.source_id, l.id]));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Quizzes</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create MCQ and short-answer quizzes for your classes.</p>
        </div>
      </div>
      <QuizzesTeacherClient
        quizzes={(quizzes ?? []).map((q) => ({ ...q, linkedAssessmentId: linkedByQuizId[q.id] ?? null })) as any[]}
        classes={(classes ?? []) as { id: string; name: string }[]}
        subjects={(subjects ?? []) as { id: string; name: string }[]}
        terms={(terms ?? []) as { id: string; name: string; is_current: boolean; start_date: string; end_date: string }[]}
      />
    </div>
  );
}
