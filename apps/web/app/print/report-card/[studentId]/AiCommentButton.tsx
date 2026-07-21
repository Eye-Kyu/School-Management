'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function AiCommentButton({
  studentId,
  termId,
  onDraft,
}: {
  studentId: string;
  termId: string;
  onDraft: (comment: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState(false);

  async function draft() {
    setLoading(true);
    try {
      const { comment } = await apiFetch<{ comment: string }>('/ai/report-card-comment', {
        method: 'POST',
        body: JSON.stringify({ studentId, termId, teacherNotes: notes || undefined }),
      });
      onDraft(comment);
      setExpanded(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setLoading(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, background: '#7c3aed', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        ✨ Draft with AI
      </button>
    );
  }

  return (
    <div style={{ border: '1px solid #ddd6fe', borderRadius: 8, padding: 12, background: '#faf5ff', marginBottom: 8 }}>
      <p style={{ fontSize: 11, fontWeight: 'bold', color: '#7c3aed', marginBottom: 6 }}>✨ AI Comment Draft</p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Optional: add bullet notes about the student (e.g. 'improved in maths, struggles with essay writing')"
        style={{ width: '100%', borderRadius: 4, border: '1px solid #e2d9f3', padding: '4px 8px', fontSize: 10, resize: 'vertical', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          onClick={draft}
          disabled={loading}
          style={{ fontSize: 11, padding: '4px 14px', borderRadius: 6, background: loading ? '#c4b5fd' : '#7c3aed', color: 'white', border: 'none', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Drafting…' : '✨ Generate draft'}
        </button>
        <button
          onClick={() => setExpanded(false)}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'white', border: '1px solid #ddd', cursor: 'pointer', color: '#666' }}
        >
          Cancel
        </button>
      </div>
      {loading && (
        <p style={{ fontSize: 10, color: '#7c3aed', marginTop: 4 }}>Claude is reading the student's data…</p>
      )}
    </div>
  );
}
