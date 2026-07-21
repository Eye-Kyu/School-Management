'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

type GeneratedQuestion = {
  body: string;
  kind: 'MCQ' | 'SHORT_ANSWER';
  options?: { id: string; text: string }[];
  correct_option_id?: string | null;
  explanation: string;
  points: number;
};

export default function AiQuizGenerator({
  quizId,
  onQuestionsAdded,
}: {
  quizId: string;
  onQuestionsAdded: (questions: GeneratedQuestion[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'text' | 'pdf'>('text');
  const [content, setContent] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [count, setCount] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<GeneratedQuestion[]>([]);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);

  async function generate() {
    setGenerating(true);
    setErr('');
    setPreview([]);
    try {
      let body: { content: string; count: number; contentType: 'text' | 'pdf_base64' };

      if (tab === 'pdf' && pdfFile) {
        const ab = await pdfFile.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
        body = { content: b64, count, contentType: 'pdf_base64' };
      } else {
        if (!content.trim()) { setErr('Please paste lesson content first.'); setGenerating(false); return; }
        body = { content: content.trim(), count, contentType: 'text' };
      }

      const { questions } = await apiFetch<{ questions: GeneratedQuestion[] }>('/ai/generate-quiz', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPreview(questions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  function addAll() {
    setAdding(true);
    try {
      onQuestionsAdded(preview);
      setPreview([]);
      setOpen(false);
      setContent('');
      setPdfFile(null);
    } finally {
      setAdding(false);
    }
  }

  function updateQuestion(i: number, patch: Partial<GeneratedQuestion>) {
    setPreview((p) => p.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function updateOption(i: number, optionId: string, text: string) {
    setPreview((p) => p.map((q, idx) => {
      if (idx !== i || !q.options) return q;
      return { ...q, options: q.options.map((o) => (o.id === optionId ? { ...o, text } : o)) };
    }));
  }

  function removeQuestion(i: number) {
    setPreview((p) => p.filter((_, idx) => idx !== i));
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-violet-300 bg-violet-50 text-violet-700 text-sm font-medium hover:bg-violet-100 transition-colors"
      >
        <span className="text-lg">✨</span> Generate with AI
      </button>
    );
  }

  return (
    <div className="bg-white border border-violet-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <span>✨</span> AI Quiz Generator
        </h3>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl w-6 h-6 flex items-center justify-center">×</button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
        <button
          onClick={() => setTab('text')}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'text' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Paste text
        </button>
        <button
          onClick={() => setTab('pdf')}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'pdf' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Upload PDF
        </button>
      </div>

      {tab === 'text' ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          placeholder="Paste your lesson notes, textbook excerpt, or learning objectives here…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none"
        />
      ) : (
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center">
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            className="hidden"
            id="pdf-upload"
          />
          <label htmlFor="pdf-upload" className="cursor-pointer">
            <p className="text-2xl mb-2">📄</p>
            <p className="text-sm font-medium text-slate-700">{pdfFile ? pdfFile.name : 'Click to upload PDF'}</p>
            <p className="text-xs text-slate-400 mt-1">Lesson notes, textbook pages, study materials</p>
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Questions</label>
          <select value={count} onChange={(e) => setCount(parseInt(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} questions</option>)}
          </select>
        </div>
        <button
          onClick={generate}
          disabled={generating || (tab === 'pdf' && !pdfFile) || (tab === 'text' && !content.trim())}
          className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Claude is thinking…
            </>
          ) : '✨ Generate questions'}
        </button>
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">{preview.length} questions generated</p>
            <button
              onClick={addAll}
              disabled={adding}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              {adding ? 'Adding…' : `Add all ${preview.length} to quiz`}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {preview.map((q, i) => (
              <div key={i} className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs flex items-center justify-center font-semibold mt-1.5">{i + 1}</span>
                  <div className="flex-1 space-y-1.5">
                    <textarea
                      value={q.body}
                      onChange={(e) => updateQuestion(i, { body: e.target.value })}
                      rows={2}
                      className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm resize-none bg-white"
                    />
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded inline-block ${q.kind === 'MCQ' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                        {q.kind === 'MCQ' ? 'Multiple choice' : 'Short answer'}
                      </span>
                      <label className="text-xs text-slate-500 flex items-center gap-1">
                        Points
                        <input
                          type="number"
                          min={1}
                          value={q.points}
                          onChange={(e) => updateQuestion(i, { points: parseInt(e.target.value) || 1 })}
                          className="w-14 rounded-md border border-slate-200 px-1.5 py-0.5 text-xs bg-white"
                        />
                      </label>
                    </div>
                    {q.kind === 'MCQ' && q.options && (
                      <div className="space-y-1">
                        {q.options.map((o) => (
                          <div key={o.id} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`correct-${i}`}
                              checked={o.id === q.correct_option_id}
                              onChange={() => updateQuestion(i, { correct_option_id: o.id })}
                              className="shrink-0"
                            />
                            <span className="text-xs text-slate-500 w-4">{o.id}.</span>
                            <input
                              value={o.text}
                              onChange={(e) => updateOption(i, o.id, e.target.value)}
                              className={`flex-1 rounded-md border px-2 py-0.5 text-xs bg-white ${o.id === q.correct_option_id ? 'border-emerald-300' : 'border-slate-200'}`}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeQuestion(i)}
                    title="Remove this question"
                    className="shrink-0 text-slate-300 hover:text-rose-500 transition-colors text-lg leading-none px-1"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
