'use client';

import { useState } from 'react';

// Small, dismissible text banner for a query-param-driven "you were
// redirected here because access was denied" message — this app has no
// toast library and no precedent for passing a message across a redirect
// (every existing role-guard redirect, e.g. the super-admin layout, is
// silent). Student 360's page-level access check is the first place that
// needed one; kept generic (a `reason` -> message map) rather than
// hardcoded to Student 360 specifically, since a future redirect-denial
// case can reuse it by adding a key.
const MESSAGES: Record<string, string> = {
  'student-360': "You don't have access to this student's Student 360 view.",
};

export default function DeniedBanner({ reason }: { reason?: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (!reason || dismissed || !MESSAGES[reason]) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2.5">
      <span>{MESSAGES[reason]}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-amber-600 hover:text-amber-900 text-xs font-medium shrink-0"
      >
        Dismiss
      </button>
    </div>
  );
}
