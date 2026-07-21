'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import AiCommentButton from './AiCommentButton';

export default function CommentForm({
  studentId, termId, existing,
}: {
  studentId: string;
  termId: string;
  existing: { classTeacher: string; headTeacher: string; isPublished: boolean } | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [ct, setCt] = useState(existing?.classTeacher ?? '');
  const [ht, setHt] = useState(existing?.headTeacher ?? '');
  const [publish, setPublish] = useState(existing?.isPublished ?? false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { data: userRow } = await supabase.from('users').select('id, school_id').maybeSingle();
    await supabase.from('student_report_cards').upsert({
      school_id: userRow?.school_id,
      student_id: studentId,
      term_id: termId,
      class_teacher_comment: ct.trim() || null,
      head_teacher_comment: ht.trim() || null,
      is_published: publish,
      published_at: publish ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'student_id,term_id' });
    setSaving(false);
    router.push(`/print/report-card/${studentId}?termId=${termId}`);
    router.refresh();
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>Edit comments</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 'bold' }}>Class Teacher&apos;s Comment</label>
            <AiCommentButton studentId={studentId} termId={termId} onDraft={(draft) => setCt(draft)} />
          </div>
          <textarea value={ct} onChange={(e) => setCt(e.target.value)} rows={4} maxLength={500}
            style={{ width: '100%', borderRadius: 6, border: '1px solid #cbd5e1', padding: '6px 10px', fontSize: 11, resize: 'vertical' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Head Teacher&apos;s Comment</label>
          <textarea value={ht} onChange={(e) => setHt(e.target.value)} rows={4} maxLength={500}
            style={{ width: '100%', borderRadius: 6, border: '1px solid #cbd5e1', padding: '6px 10px', fontSize: 11, resize: 'vertical' }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          Publish to student &amp; parent
        </label>
        <button onClick={save} disabled={saving}
          style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, background: '#0f172a', color: 'white', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save & close'}
        </button>
        <a href={`/print/report-card/${studentId}?termId=${termId}`}
          style={{ fontSize: 11, color: '#64748b', textDecoration: 'underline' }}>
          Cancel
        </a>
      </div>
    </div>
  );
}
