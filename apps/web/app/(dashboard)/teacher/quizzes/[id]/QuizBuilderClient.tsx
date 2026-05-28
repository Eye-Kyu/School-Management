'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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

export default function QuizBuilderClient({
  quiz, initialQuestions, attempts,
}: {
  quiz: { id: string; is_published: boolean };
  initialQuestions: Question[];
  attempts: Attempt[];
}) {
  const supabase = createClient();
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
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

    const { data: userRow } = await supabase.from('users').select('school_id').maybeSingle();
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
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => {
                  const pct = a.score != null && a.max_score ? ((a.score / a.max_score) * 100).toFixed(1) : null;
                  return (
                    <tr key={a.id} className="border-t border-slate-100">
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
                    </tr>
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
