import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import BackButton from '@/components/BackButton';
import QuizBuilderClient from './QuizBuilderClient';

export default async function QuizBuilderPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: quiz } = await supabase
    .from('quizzes')
    .select('id, title, is_published, time_limit_mins, shuffle_questions, shuffle_options, class:classes(id, name), subject:subjects(name)')
    .eq('id', params.id)
    .maybeSingle();

  if (!quiz) notFound();

  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('id, position, kind, body, options, correct_option_id, points')
    .eq('quiz_id', params.id)
    .order('position');

  const { data: attempts } = await supabase
    .from('quiz_attempts')
    .select('id, student_id, submitted_at, score, max_score, tab_blur_count, student:students!student_id(user:users!user_id(full_name))')
    .eq('quiz_id', params.id)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher/quizzes" />
        <div>
          <h1 className="text-2xl font-semibold">{quiz.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {(quiz.class as any)?.name}
            {(quiz.subject as any)?.name ? ` · ${(quiz.subject as any).name}` : ''}
            {quiz.time_limit_mins ? ` · ${quiz.time_limit_mins} min` : ''}
          </p>
        </div>
      </div>
      <QuizBuilderClient
        quiz={quiz as any}
        initialQuestions={(questions ?? []) as any[]}
        attempts={(attempts ?? []) as any[]}
      />
    </div>
  );
}
