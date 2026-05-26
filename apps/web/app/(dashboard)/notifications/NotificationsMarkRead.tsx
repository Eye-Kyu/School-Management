'use client';

import { useEffect } from 'react';
import { apiFetch } from '@/lib/api';

export default function NotificationsMarkRead({ ids }: { ids: string[] }) {
  useEffect(() => {
    if (ids.length === 0) return;
    apiFetch('/notifications/read', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
