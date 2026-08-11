'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

// Never links directly to a Storage URL (the bucket is private, BUG-10) —
// fetches a short-lived signed URL from the API, which re-checks
// visibility and logs the download, then navigates to it.
export default function DownloadButton({ documentId, title, className, children }: {
  documentId: string;
  title: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function handleDownload() {
    setLoading(true);
    setErr('');
    try {
      const { url } = await apiFetch<{ url: string; expiresAt: string }>(`/documents/${documentId}/download-url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        title={title}
        className={className ?? 'text-violet-700 hover:underline text-sm font-medium disabled:opacity-50'}
      >
        {children ?? (loading ? 'Preparing…' : 'Download')}
      </button>
      {err && <span className="block text-xs text-rose-600 mt-0.5">{err}</span>}
    </span>
  );
}
