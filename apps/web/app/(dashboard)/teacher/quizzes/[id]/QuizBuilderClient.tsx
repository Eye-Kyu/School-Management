'use client';

import { Fragment, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentUserRow } from '@/lib/supabase/currentUser';
import AiQuizGenerator from './AiQuizGenerator';

type Option = { id: string; text: string };
type Question = {
  id: string; position: number; kind: 'MCQ' | 'SHORT_ANSWER';
  body: string; options: Option[] | null; correct_option_id: string | null; points: number;
};
type Attempt = {
  id: string; student_id: string; submitted_at: string;
  score: number | null; max_score: number | null; tab_blur_count: number;
  student: { user: { full_name: string } };
};

function uid() { return Math.random().toString(36).slice(2, 9); }

function ShortAnswerReview({
  attempts, questions, onScoreUpdate,
}: {
  attempts: Attempt[];
  questions: Question[];
  onScoreUpdate: (attemptId: string, newScore: number) => void;
}) {
  const supabase = createClient();
  const [scores, setScores] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const submitted = attempts.filter((a) => a.submitted_at);

  async function finalise(attempt: Attempt) {
    const key = attempt.id;
    setSaving((p) => ({ ...p, [key]: true }));

    // Calculate total score: MCQ score already in attempt + short-answer scores entered
    const saBonus = questions.reduce((sum, q) => {
      const raw = scores[key]?.[q.id];
      return sum + (raw ? parseFloat(raw) || 0 : 0);
    }, 0);
    const newScore = (attempt.score ?? 0) + saBonus;

    await supabase.from('quiz_attempts')
      .update({ score: newScore })
      .eq('id', attempt.id);

    // Quiz scores live entirely in quiz_attempts (their own score/max_score
    // columns) — quiz results are never pushed into the gradebook's `grades`
    // table, which is scoped to real teacher-created `assessments` rows only.

    onScoreUpdate(attempt.id, newScore);
    setSaving((p) => ({ ...p, [key]: false }));
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
        Short-answer review ({submitted.length} submissions)
      </h2>
      {submitted.map((attempt) => {
        const answers = attempt as unknown as { answers: Record<string, string> };
        const key = attempt.id;
        return (
          <div key={key} className="bg-white border border-blue-100 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-800">{(attempt.student as any)?.user?.full_name}</p>
              <button
                onClick={() => finalise(attempt)}
                disabled={saving[key]}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving[key] ? 'Saving…' : 'Finalise score'}
              </button>
            </div>
            {questions.map((q) => (
              <div key={q.id} className="space-y-2">
                <p className="text-sm font-medium text-slate-700">{q.body} <span className="text-xs text-slate-400">({q.points} pt{q.points !== 1 ? 's' : ''})</span></p>
                <div className="bg-slate-50 rounded-lg px-4 py-2 text-sm text-slate-600 italic">
                  {(answers as any).answers?.[q.id] ?? <span className="text-slate-400">No answer</span>}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Score:</label>
                  <input
                    type="number" min={0} max={q.points} step={0.5}
                    value={scores[key]?.[q.id] ?? ''}
                    onChange={(e) => setScores((p) => ({
                      ...p,
                      [key]: { ...(p[key] ?? {}), [q.id]: e.target.value },
                    }))}
                    className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-center"
                    placeholder={`/ ${q.points}`}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function QuizBuilderClient({
  quiz, initialQuestions, attempts: initialAttempts,
}: {
  quiz: { id: string; is_published: boolean };
  initialQuestions: Question[];
  attempts: Attempt[];
}) {
  const supabase = createClient();
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [attempts, setAttempts] = useState<Attempt[]>(initialAttempts);
  const [resetOpen, setResetOpen] = useState<string | null>(null);
  const [resetReason, setResetReason] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<Record<string, boolean>>({});
  const [resetError, setResetError] = useState<Record<string, string>>({});

  async function resetAttempt(attempt: Attempt) {
    const reason = (resetReason[attempt.id] ?? '').trim();
    if (reason.length < 10) {
      setResetError((p) => ({ ...p, [attempt.id]: 'Reason must be at least 10 characters.' }));
      return;
    }
    setResetting((p) => ({ ...p, [attempt.id]: true }));
    setResetError((p) => ({ ...p, [attempt.id]: '' }));

    const userRow = await getCurrentUserRow('id, school_id');
    const { data: deleted, error } = await supabase.from('quiz_attempts').delete()
      .eq('id', attempt.id).select('id');

    if (error) {
      setResetError((p) => ({ ...p, [attempt.id]: error.message }));
      setResetting((p) => ({ ...p, [attempt.id]: false }));
      return;
    }
    if (!deleted || deleted.length === 0) {
      setResetError((p) => ({ ...p, [attempt.id]: "You don't have permission to reset this attempt." }));
      setResetting((p) => ({ ...p, [attempt.id]: false }));
      return;
    }

    await supabase.from('audit_logs').insert({
      id: crypto.randomUUID(),
      school_id: userRow?.school_id,
      user_id: userRow?.id,
      action: 'quiz.reset',
      entity_type: 'quiz_attempt',
      entity_id: attempt.id,
      metadata: { student_id: attempt.student_id, reason, teacher_id: userRow?.id },
    });

    setAttempts((prev) => prev.filter((a) => a.id !== attempt.id));
    setResetOpen(null);
    setResetReason((p) => ({ ...p, [attempt.id]: '' }));
    setResetting((p) => ({ ...p, [attempt.id]: false }));
  }

  const [adding, setAdding] = useState<'MCQ' | 'SHORT_ANSWER' | null>(null);
  const [body, setBody] = useState('');
  const [points, setPoints] = useState('1');
  const [options, setOptions] = useState<Option[]>([
    { id: uid(), text: '' }, { id: uid(), text: '' }, { id: uid(), text: '' }, { id: uid(), text: '' },
  ]);
  const [correctId, setCorrectId] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);

    const { data: authData } = await supabase.auth.getUser();
    const { data: userRow } = await supabase.from('users').select('school_id').eq('auth_id', authData?.user?.id ?? '').maybeSingle();
    const isMCQ = adding === 'MCQ';
    const validOptions = isMCQ ? options.filter((o) => o.text.trim()) : null;

    const { data } = await supabase.from('quiz_questions').insert({
      quiz_id: quiz.id,
      school_id: userRow?.school_id,
      position: questions.length,
      kind: adding,
      body: body.trim(),
      options: validOptions ?? null,
      correct_option_id: isMCQ ? correctId || null : null,
      points: parseFloat(points) || 1,
    }).select('id, position, kind, body, options, correct_option_id, points').single();

    if (data) {
      setQuestions((p) => [...p, data as any]);
      setAdding(null); setBody(''); setPoints('1'); setCorrectId('');
      setOptions([{ id: uid(), text: '' }, { id: uid(), text: '' }, { id: uid(), text: '' }, { id: uid(), text: '' }]);
    }
    setSaving(false);
  }

  async function deleteQuestion(id: string) {
    await supabase.from('quiz_questions').delete().eq('id', id);
    setQuestions((p) => p.filter((q) => q.id !== id));
  }

  // Save AI-generated questions in bulk
  async function handleAiQuestions(generated: { body: string; kind: 'MCQ' | 'SHORT_ANSWER'; options?: { id: string; text: string }[]; correct_option_id?: string | null; points: number }[]) {
    const { data: authData } = await supabase.auth.getUser();
    const { data: userRow } = await supabase.from('users').select('school_id').eq('auth_id', authData?.user?.id ?? '').maybeSingle();
    for (let i = 0; i < generated.length; i++) {
      const q = generated[i]!;
      const { data } = await supabase.from('quiz_questions').insert({
        quiz_id: quiz.id,
        school_id: userRow?.school_id,
        position: questions.length + i,
        kind: q.kind,
        body: q.body,
        options: q.kind === 'MCQ' && q.options ? q.options : null,
        correct_option_id: q.kind === 'MCQ' ? (q.correct_option_id ?? null) : null,
        points: q.points ?? 1,
      }).select('id, position, kind, body, options, correct_option_id, points').single();
      if (data) setQuestions((p) => [...p, data as Question]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Questions list */}
      <div className="space-y-3">
        {questions.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No questions yet. Add MCQ or short-answer questions below.
          </div>
        )}
        {questions.map((q, i) => (
          <div key={q.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-2 items-start">
                <span className="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-slate-800">{q.body}</p>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${q.kind === 'MCQ' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                    {q.kind === 'MCQ' ? 'Multiple choice' : 'Short answer'} · {q.points} pt{q.points !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <button onClick={() => deleteQuestion(q.id)} className="text-slate-300 hover:text-rose-500 transition-colors text-lg leading-none shrink-0">×</button>
            </div>
            {q.kind === 'MCQ' && q.options && (
              <div className="ml-8 space-y-1">
                {(q.options as Option[]).map((o) => (
                  <div key={o.id} className={`text-sm px-3 py-1.5 rounded-lg ${o.id === q.correct_option_id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-600'}`}>
                    {o.id === q.correct_option_id && '✓ '}{o.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI Generator */}
      <AiQuizGenerator quizId={quiz.id} onQuestionsAdded={handleAiQuestions} />

      {/* Add question */}
      {!adding ? (
        <div className="flex gap-2">
          <button onClick={() => setAdding('MCQ')}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            + Multiple choice (MCQ)
          </button>
          <button onClick={() => setAdding('SHORT_ANSWER')}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            + Short answer
          </button>
        </div>
      ) : (
        <form onSubmit={saveQuestion} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-800">
            New {adding === 'MCQ' ? 'multiple choice' : 'short answer'} question
          </h3>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Question</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
          </div>

          {adding === 'MCQ' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Options (tick the correct one)</label>
              {options.map((opt, i) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input type="radio" name="correct" value={opt.id} checked={correctId === opt.id}
                    onChange={() => setCorrectId(opt.id)} className="shrink-0" />
                  <input value={opt.text}
                    onChange={(e) => setOptions((p) => p.map((o) => o.id === opt.id ? { ...o, text: e.target.value } : o))}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Points</label>
              <input type="number" min="0.5" step="0.5" value={points} onChange={(e) => setPoints(e.target.value)}
                className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(null)}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Add question'}
            </button>
          </div>
        </form>
      )}

      {/* Short-answer review */}
      {attempts.length > 0 && questions.some((q) => q.kind === 'SHORT_ANSWER') && (
        <ShortAnswerReview
          attempts={attempts}
          questions={questions.filter((q) => q.kind === 'SHORT_ANSWER')}
          onScoreUpdate={(attemptId, newScore) =>
            setAttempts((prev) =>
              prev.map((a) => a.id === attemptId ? { ...a, score: newScore } : a)
            )
          }
        />
      )}

      {/* Results */}
      {attempts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Results ({attempts.length})</h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Student</th>
                  <th className="px-4 py-2 text-center font-medium">Score</th>
                  <th className="px-4 py-2 text-center font-medium">%</th>
                  <th className="px-4 py-2 text-center font-medium">Tab switches</th>
                  <th className="px-4 py-2 text-right font-medium">Submitted</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => {
                  const pct = a.score != null && a.max_score ? ((a.score / a.max_score) * 100).toFixed(1) : null;
                  return (
                    <Fragment key={a.id}>
                      <tr className="border-t border-slate-100">
                        <td className="px-4 py-2.5">{(a.student as any)?.user?.full_name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-center">{a.score ?? '—'} / {a.max_score ?? '—'}</td>
                        <td className={`px-4 py-2.5 text-center font-medium ${pct ? parseFloat(pct) >= 70 ? 'text-emerald-600' : parseFloat(pct) >= 50 ? 'text-amber-600' : 'text-rose-600' : ''}`}>
                          {pct ? `${pct}%` : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-center ${a.tab_blur_count > 2 ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
                          {a.tab_blur_count}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-400 text-xs">
                          {new Date(a.submitted_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => setResetOpen(resetOpen === a.id ? null : a.id)}
                            className="text-xs text-rose-500 hover:text-rose-700 underline">
                            Reset
                          </button>
                        </td>
                      </tr>
                      {resetOpen === a.id && (
                        <tr className="border-t border-slate-100 bg-rose-50/40">
                          <td colSpan={6} className="px-4 py-3 space-y-2">
                            <p className="text-xs text-slate-500">
                              This permanently deletes {(a.student as any)?.user?.full_name ?? 'this student'}'s attempt so they can retake the quiz before the deadline. This cannot be undone.
                            </p>
                            <textarea rows={2} placeholder="Reason for reset (required, min 10 characters)…"
                              value={resetReason[a.id] ?? ''}
                              onChange={(e) => setResetReason((p) => ({ ...p, [a.id]: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
                            {resetError[a.id] && <p className="text-xs text-rose-600">{resetError[a.id]}</p>}
                            <div className="flex justify-end gap-2">
                              <button onClick={() => setResetOpen(null)}
                                className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
                                Cancel
                              </button>
                              <button onClick={() => resetAttempt(a)} disabled={resetting[a.id]}
                                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-500 disabled:opacity-50">
                                {resetting[a.id] ? 'Resetting…' : 'Confirm reset'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
