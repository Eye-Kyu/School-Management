'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4 p-4">
      <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-2xl">⚠</div>
      <h2 className="text-lg font-semibold text-slate-800">Failed to load this page</h2>
      <p className="text-sm text-slate-500 max-w-sm">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <button
        onClick={reset}
        className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700"
      >
        Try again
      </button>
    </div>
  );
}
