import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import QuizTaker from './QuizTaker';
import QuizReview from './QuizReview';
import AttachedDocumentsSection from '@/components/documents/AttachedDocumentsSection';

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
    .select('id, title, time_limit_mins, shuffle_questions, shuffle_options, school_id, closes_at')
    .eq('id', params.id).eq('is_published', true).maybeSingle();

  if (!quiz || !student) redirect('/student/quizzes');

  // Check if already submitted
  const { data: existing } = await supabase
    .from('quiz_attempts')
    .select('submitted_at, score, max_score, answers')
    .eq('quiz_id', params.id).eq('student_id', student.id).maybeSingle();

  // Once submitted, the attempt is locked — show a read-only review (with
  // correctness for MCQ, a genuine learning benefit) instead of re-entering
  // the taker or redirecting away and hiding the student's own answers.
  if (existing?.submitted_at) {
    const { data: reviewQuestions } = await supabase
      .from('quiz_questions')
      .select('id, position, kind, body, options, points, correct_option_id')
      .eq('quiz_id', params.id)
      .order('position');

    return (
      <div className="space-y-6">
        <QuizReview
          quizTitle={quiz.title}
          questions={(reviewQuestions ?? []) as any[]}
          attempt={existing as any}
        />
        <AttachedDocumentsSection scopeSubtype="QUIZ" scopeId={params.id} canManage={false} />
      </div>
    );
  }

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
