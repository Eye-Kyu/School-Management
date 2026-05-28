import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import QuizTaker from './QuizTaker';

export default async function TakeQuizPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();
  const { data: student } = await supabase
    .from('students').select('id').eq('user_id', userRow?.id ?? '').maybeSingle();

  const { data: quiz } = await supabase
    .from('quizzes')
    .select('id, title, time_limit_mins, shuffle_questions, shuffle_options, school_id')
    .eq('id', params.id).eq('is_published', true).maybeSingle();

  if (!quiz || !student) redirect('/student/quizzes');

  // Check if already submitted
  const { data: existing } = await supabase
    .from('quiz_attempts')
    .select('submitted_at, score, max_score')
    .eq('quiz_id', params.id).eq('student_id', student.id).maybeSingle();

  if (existing?.submitted_at) redirect('/student/quizzes');

  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('id, position, kind, body, options, points')
    .eq('quiz_id', params.id)
    .order('position');

  return (
    <QuizTaker
      quiz={quiz as any}
      questions={(questions ?? []) as any[]}
      studentId={student.id}
      existingAttempt={existing as any}
    />
  );
}
