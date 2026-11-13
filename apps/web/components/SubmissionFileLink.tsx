'use client';

// Opens an assignment submission file through a short-lived signed URL
// (SA-02: the `assignments` bucket is private). Values that are not
// assignments-bucket paths are rendered as plain text, never as a link, so a
// student-written URL in submissions.file_urls cannot become a clickable
// href in the teacher view.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ASSIGNMENTS_BUCKET, submissionFileName, toAssignmentStoragePath } from '@/lib/assignments/submissionFiles';

const SIGNED_URL_TTL_SECONDS = 60;

export default function SubmissionFileLink({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const path = toAssignmentStoragePath(value);

  if (!path) {
    return <span className="text-xs text-slate-400">Unsupported file reference</span>;
  }

  async function open() {
    setOpening(true);
    setError('');
    try {
      const { data, error: signErr } = await createClient()
        .storage.from(ASSIGNMENTS_BUCKET)
        .createSignedUrl(path!, SIGNED_URL_TTL_SECONDS);
      if (signErr || !data?.signedUrl) throw new Error(signErr?.message ?? 'Could not open file');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open file');
    } finally {
      setOpening(false);
    }
  }

  return (
    <span>
      <button type="button" onClick={open} disabled={opening} className={className ?? 'text-sm text-blue-600 hover:underline'}>
        {opening ? 'Opening…' : (label ?? submissionFileName(path))}
      </button>
      {error && <span className="ml-2 text-xs text-rose-600">{error}</span>}
    </span>
  );
}
