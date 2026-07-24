'use client';

import { useRouter } from 'next/navigation';

type Option = { id: string; text: string };
type Question = {
  id: string; kind: 'MCQ' | 'SHORT_ANSWER'; body: string;
  options: Option[] | null; points: number; correct_option_id: string | null;
};
type Attempt = {
  submitted_at: string; score: number | null; max_score: number | null;
  answers: Record<string, string>;
};

export default function QuizReview({
  quizTitle, questions, attempt,
}: {
  quizTitle: string;
  questions: Question[];
  attempt: Attempt;
}) {
  const router = useRouter();
  const pct = attempt.max_score ? ((Number(attempt.score ?? 0) / Number(attempt.max_score)) * 100).toFixed(1) : null;

  return (
    <div className="max-w-2xl mx-auto space-y-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{quizTitle}</h1>
          <p className="text-xs text-slate-400">
            Attempt completed on {new Date(attempt.submitted_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        {pct !== null && (
          <span className={`text-sm font-semibold px-3 py-1 rounded-lg ${
            parseFloat(pct) >= 70 ? 'bg-emerald-100 text-emerald-700' : parseFloat(pct) >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
          }`}>
            Score: {attempt.score ?? 0}/{attempt.max_score ?? 0}
          </span>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
        This attempt is complete and cannot be resubmitted. Review your questions and answers below.
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => {
          const myAnswer = attempt.answers?.[q.id];
          const isMcq = q.kind === 'MCQ';
          const isCorrect = isMcq && q.correct_option_id != null && myAnswer === q.correct_option_id;
          return (
            <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-400 mb-1">
                    {q.kind === 'MCQ' ? 'Multiple choice' : 'Short answer'} · {q.points} pt{q.points !== 1 ? 's' : ''}
                  </p>
                  <p className="text-base text-slate-800">{q.body}</p>
                </div>
                {isMcq && (
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                    isCorrect ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }`}>
                    {isCorrect ? '✓ Correct' : '✗ Incorrect'}
                  </span>
                )}
              </div>

              {isMcq && q.options ? (
                <div className="space-y-2 ml-10">
                  {q.options.map((opt) => {
                    const isMine = myAnswer === opt.id;
                    const isRight = q.correct_option_id === opt.id;
                    return (
                      <div key={opt.id}
                        className={`px-4 py-2.5 rounded-xl border text-sm ${
                          isRight ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                          : isMine ? 'border-rose-400 bg-rose-50 text-rose-800'
                          : 'border-slate-200 text-slate-600'
                        }`}>
                        {opt.text}
                        {isRight && <span className="ml-2 text-xs font-medium">(correct answer)</span>}
                        {isMine && !isRight && <span className="ml-2 text-xs font-medium">(your answer)</span>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="ml-10 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
                  {myAnswer || <span className="text-slate-400">No answer given.</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={() => router.push('/student/quizzes')}
        className="px-6 py-2.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-700">
        Back to quizzes
      </button>
    </div>
  );
}
