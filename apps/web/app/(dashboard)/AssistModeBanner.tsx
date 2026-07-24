'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function AssistModeBanner({
  schoolName, superAdminName, schoolId, accessGrantId,
}: { schoolName: string; superAdminName: string; schoolId: string; accessGrantId: string }) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  async function handleExit() {
    setExiting(true);
    try {
      await apiFetch('/super-admin/privileged-access/exit-assist', {
        method: 'POST',
        body: JSON.stringify({ targetSchoolId: schoolId, accessGrantId }),
      }).catch(() => {});
    } finally {
      await fetch('/api/assist-mode/exit', { method: 'POST' });
      router.push('/super-admin');
      router.refresh();
    }
  }

  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 flex-wrap text-center">
      <span>
        SuperAdmin assist mode — accessing <strong>{schoolName}</strong> as <strong>{superAdminName}</strong>. All actions are audited.
      </span>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="underline font-semibold hover:no-underline disabled:opacity-50"
      >
        {exiting ? 'Exiting…' : 'Exit assist mode →'}
      </button>
    </div>
  );
}
