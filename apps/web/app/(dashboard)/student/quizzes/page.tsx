import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import Link from 'next/link';

export default async function StudentQuizzesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();
  const { data: student } = await supabase
    .from('students').select('id, current_class_id')
    .eq('user_id', userRow?.id ?? '').maybeSingle();

  const [{ data: quizzes }, { data: attempts }] = await Promise.all([
    student
      ? supabase.from('quizzes')
          .select('id, title, time_limit_mins, subject:subjects(name), created_at')
          .eq('class_id', student.current_class_id ?? '')
          .eq('is_published', true)
          .order('created_at', { ascending: false })
      : { data: [] },
    student
      ? supabase.from('quiz_attempts')
          .select('quiz_id, submitted_at, score, max_score')
          .eq('student_id', student.id)
      : { data: [] },
  ]);

  const attemptMap = Object.fromEntries((attempts ?? []).map((a) => [a.quiz_id, a]));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/student" />
        <div>
          <h1 className="text-2xl font-semibold">Quizzes</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your assigned quizzes.</p>
        </div>
      </div>

      {(quizzes ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No quizzes available yet.
        </div>
      ) : (
        <div className="space-y-2">
          {(quizzes ?? []).map((q: any) => {
            const attempt = attemptMap[q.id];
            const done = attempt?.submitted_at != null;
            const pct = done && attempt.score != null && attempt.max_score
              ? ((attempt.score / attempt.max_score) * 100).toFixed(1) : null;
            return (
              <div key={q.id} className={`flex items-center gap-4 bg-white border rounded-xl px-5 py-4 ${done ? 'border-emerald-200' : 'border-slate-200'}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800">{q.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {q.subject?.name ?? ''}
                    {q.time_limit_mins ? ` · ${q.time_limit_mins} min` : ' · No time limit'}
                  </p>
                </div>
                {done ? (
                  <div className="text-right">
                    <span className={`text-sm font-semibold ${pct && parseFloat(pct) >= 70 ? 'text-emerald-600' : pct && parseFloat(pct) >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                      {attempt.score} / {attempt.max_score}
                    </span>
                    {pct && <p className="text-xs text-slate-400">{pct}%</p>}
                  </div>
                ) : (
                  <Link href={`/student/quizzes/${q.id}`}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors">
                    Start quiz
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
