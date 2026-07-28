'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import posthog from 'posthog-js';

type Option = { id: string; text: string };
type Question = {
  id: string; kind: 'MCQ' | 'SHORT_ANSWER'; body: string;
  options: Option[] | null; points: number;
};
type Quiz = {
  id: string; title: string; time_limit_mins: number | null;
  shuffle_questions: boolean; shuffle_options: boolean; school_id: string;
  closes_at: string | null;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export default function QuizTaker({
  quiz, questions: rawQuestions, studentId, existingAttempt,
}: {
  quiz: Quiz;
  questions: Question[];
  studentId: string;
  existingAttempt: { answers?: Record<string, string>; started_at?: string } | null;
}) {
  const supabase = createClient();
  const router = useRouter();

  const questions = useRef<Question[]>(
    quiz.shuffle_questions ? shuffle(rawQuestions) : rawQuestions,
  ).current.map((q) => ({
    ...q,
    options: q.options && quiz.shuffle_options ? shuffle(q.options) : q.options,
  }));

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(existingAttempt?.answers ?? {});
  const [tabBlurs, setTabBlurs] = useState(0);
  const [showBlurWarning, setShowBlurWarning] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(() => {
    if (!quiz.time_limit_mins) return null;
    if (existingAttempt?.started_at) {
      const elapsed = (Date.now() - new Date(existingAttempt.started_at).getTime()) / 1000;
      return Math.max(0, quiz.time_limit_mins * 60 - elapsed);
    }
    return quiz.time_limit_mins * 60;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ score: number; max: number } | null>(null);
  const attemptId = useRef<string | null>(null);

  const isPastDeadline = quiz.closes_at ? new Date() > new Date(quiz.closes_at) : false;

  // Upsert attempt on mount — skipped once the deadline has passed, since
  // qa_insert/qa_update RLS would reject it anyway (see closes_at).
  useEffect(() => {
    if (isPastDeadline) return;
    (async () => {
      const { data } = await supabase.from('quiz_attempts').upsert({
        school_id: quiz.school_id,
        quiz_id: quiz.id,
        student_id: studentId,
        started_at: existingAttempt ? undefined : new Date().toISOString(),
        answers: existingAttempt?.answers ?? {},
      }, { onConflict: 'quiz_id,student_id' }).select('id').single();
      if (data) attemptId.current = data.id;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab blur detection
  useEffect(() => {
    function onBlur() {
      setTabBlurs((n) => {
        const next = n + 1;
        supabase.from('quiz_attempts').update({ tab_blur_count: next, answers })
          .eq('quiz_id', quiz.id).eq('student_id', studentId).then(() => {});
        setShowBlurWarning(true);
        return next;
      });
    }
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  // Timer
  useEffect(() => {
    if (timeLeft === null) return;
    if (timeLeft <= 0) { handleSubmit(); return; }
    const t = setInterval(() => setTimeLeft((s) => (s !== null ? s - 1 : null)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  // Save answers debounced
  const saveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setAnswer(qid: string, val: string) {
    const updated = { ...answers, [qid]: val };
    setAnswers(updated);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => {
      supabase.from('quiz_attempts').update({ answers: updated })
        .eq('quiz_id', quiz.id).eq('student_id', studentId).then(() => {});
    }, 1000);
  }

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted) return;
    setSubmitting(true);

    // Auto-grade MCQ
    let score = 0;
    let maxScore = 0;
    for (const q of rawQuestions) {
      maxScore += q.points;
      if (q.kind === 'MCQ' && (q as any).correct_option_id) {
        if (answers[q.id] === (q as any).correct_option_id) score += q.points;
      }
      // SHORT_ANSWER queued for teacher review — score stays 0 until graded
    }

    await supabase.from('quiz_attempts').update({
      submitted_at: new Date().toISOString(),
      score,
      max_score: maxScore,
      answers,
    }).eq('quiz_id', quiz.id).eq('student_id', studentId);

    posthog.capture('quiz_submitted', {
      score,
      max_score: maxScore,
      question_count: rawQuestions.length,
      answered_count: Object.keys(answers).length,
    });
    setResult({ score, max: maxScore });
    setSubmitted(true);
    setSubmitting(false);
  }, [answers, submitting, submitted, rawQuestions, quiz.id, studentId, supabase]);

  if (submitted && result) {
    const pct = result.max > 0 ? ((result.score / result.max) * 100).toFixed(1) : '0';
    const mcqCount = rawQuestions.filter((q) => q.kind === 'MCQ').length;
    const saCount = rawQuestions.filter((q) => q.kind === 'SHORT_ANSWER').length;
    return (
      <div className="max-w-lg mx-auto text-center space-y-6 py-16">
        <div className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center text-3xl font-bold text-white ${
          parseFloat(pct) >= 70 ? 'bg-emerald-500' : parseFloat(pct) >= 50 ? 'bg-amber-500' : 'bg-rose-500'
        }`}>
          {pct}%
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Quiz submitted!</h1>
          <p className="text-slate-500 mt-1">
            You scored {result.score} / {result.max} marks.
            {saCount > 0 && <> {saCount} short-answer question{saCount > 1 ? 's' : ''} will be reviewed by your teacher.</>}
          </p>
        </div>
        <button onClick={() => router.push('/student/quizzes')}
          className="px-6 py-2.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-700">
          Back to quizzes
        </button>
      </div>
    );
  }

  if (isPastDeadline) {
    const answeredCount = Object.keys(answers).length;
    return (
      <div className="max-w-lg mx-auto text-center space-y-4 py-16">
        <h1 className="text-xl font-semibold text-slate-800">{quiz.title}</h1>
        <p className="text-rose-600 font-medium">Deadline passed. Ask your teacher for an extension.</p>
        {answeredCount > 0 && (
          <p className="text-sm text-slate-500">
            You had answered {answeredCount} of {questions.length} question{questions.length !== 1 ? 's' : ''} before the deadline, but the attempt was never submitted.
          </p>
        )}
        <button onClick={() => router.push('/student/quizzes')}
          className="px-6 py-2.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-700">
          Back to quizzes
        </button>
      </div>
    );
  }

  const q = questions[current]!;
  const answered = Object.keys(answers).length;
  const progress = (answered / questions.length) * 100;

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 py-4" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{quiz.title}</h1>
          <p className="text-xs text-slate-400">{answered}/{questions.length} answered</p>
        </div>
        <div className="flex items-center gap-3">
          {timeLeft !== null && (
            <span className={`font-mono font-semibold text-sm px-3 py-1 rounded-lg ${
              timeLeft < 60 ? 'bg-rose-100 text-rose-700 animate-pulse' : 'bg-slate-100 text-slate-700'
            }`}>
              {formatTime(timeLeft)}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-slate-900 transition-all" style={{ width: `${progress}%` }} />
      </div>

      {/* Tab blur warning */}
      {showBlurWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center justify-between">
          <span>⚠ You left the quiz window ({tabBlurs} time{tabBlurs !== 1 ? 's' : ''}). This is recorded.</span>
          <button onClick={() => setShowBlurWarning(false)} className="text-amber-500 ml-4">✕</button>
        </div>
      )}

      {/* Question card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{current + 1}</span>
          <div>
            <p className="text-sm font-medium text-slate-400 mb-1">
              {q.kind === 'MCQ' ? 'Multiple choice' : 'Short answer'} · {q.points} pt{q.points !== 1 ? 's' : ''}
            </p>
            <p className="text-base text-slate-800">{q.body}</p>
          </div>
        </div>

        {q.kind === 'MCQ' && q.options && (
          <div className="space-y-2 ml-10">
            {q.options.map((opt) => (
              <button key={opt.id} onClick={() => setAnswer(q.id, opt.id)}
                className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                  answers[q.id] === opt.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 hover:border-slate-400 text-slate-700'
                }`}>
                {opt.text}
              </button>
            ))}
          </div>
        )}

        {q.kind === 'SHORT_ANSWER' && (
          <textarea
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            rows={4} maxLength={2000}
            placeholder="Type your answer here…"
            className="ml-10 w-[calc(100%-2.5rem)] rounded-xl border border-slate-200 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-2">
        <button onClick={() => setCurrent((n) => Math.max(0, n - 1))} disabled={current === 0}
          className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
          ← Prev
        </button>

        {/* Question dots */}
        <div className="flex-1 flex gap-1 flex-wrap justify-center">
          {questions.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={`w-7 h-7 rounded-full text-xs font-medium transition-all ${
                i === current ? 'bg-slate-900 text-white'
                : answers[questions[i]!.id] ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}>
              {i + 1}
            </button>
          ))}
        </div>

        {current < questions.length - 1 ? (
          <button onClick={() => setCurrent((n) => Math.min(questions.length - 1, n + 1))}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
            Next →
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit quiz'}
          </button>
        )}
      </div>
    </div>
  );
}
