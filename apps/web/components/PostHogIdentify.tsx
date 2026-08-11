'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';

export default function PostHogIdentify({ userId, role }: { userId: string; role: string }) {
  useEffect(() => {
    if (userId) {
      posthog.identify(userId, { role });
    }
  }, [userId, role]);
  return null;
}
