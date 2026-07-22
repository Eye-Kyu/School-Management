'use client';

// =============================================================================
// usePlatformPermissions - which platform-level capabilities the current
// SuperAdmin account holds
// =============================================================================
// Fetches /auth/me (the standard session-bootstrap call) and exposes the
// platformPermissions list it returns. This is a UX layer only — the real
// enforcement is server-side (NestJS PlatformPermissionGuard).
// =============================================================================

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export function usePlatformPermissions() {
  const [permissions, setPermissions] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ platformPermissions: string[] }>('/auth/me')
      .then((data) => { if (!cancelled) setPermissions(new Set(data.platformPermissions ?? [])); })
      .catch(() => { if (!cancelled) setPermissions(new Set()); });
    return () => { cancelled = true; };
  }, []);

  // While loading, treat everything as permitted — avoids a nav flash where
  // items disappear then reappear; the server enforces the real boundary.
  function hasPermission(key: string): boolean {
    if (!permissions) return true;
    return permissions.has(key);
  }

  return { hasPermission, loading: permissions === null };
}
