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
      .select('id, title, is_published, time_limit_mins, created_at, class:classes(name), subject:subjects(name)')
      .eq('created_by_id', userRow?.id ?? '')
      .order('created_at', { ascending: false }),
    supabase.from('classes').select('id, name').eq('is_active', true).order('name'),
    supabase.from('subjects').select('id, name').order('name'),
    supabase.from('terms').select('id, name, is_current').order('start_date', { ascending: false }),
  ]);

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
        quizzes={(quizzes ?? []) as any[]}
        classes={(classes ?? []) as { id: string; name: string }[]}
        subjects={(subjects ?? []) as { id: string; name: string }[]}
        terms={(terms ?? []) as { id: string; name: string; is_current: boolean }[]}
      />
    </div>
  );
}
