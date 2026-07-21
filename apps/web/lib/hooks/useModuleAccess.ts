'use client';

// =============================================================================
// useModuleAccess - which feature modules are enabled for the current user's school
// =============================================================================
// Fetches /auth/me once (already the standard session-bootstrap call) and
// exposes the enabledModules list it returns. This is a UX layer only — the
// real enforcement is server-side (NestJS FeatureGuard + RLS's module_enabled()).
// =============================================================================

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export function useModuleAccess() {
  const [enabledModules, setEnabledModules] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ enabledModules: string[] }>('/auth/me')
      .then((data) => { if (!cancelled) setEnabledModules(new Set(data.enabledModules ?? [])); })
      .catch(() => { if (!cancelled) setEnabledModules(new Set()); });
    return () => { cancelled = true; };
  }, []);

  // While loading, treat everything as enabled — avoids a nav flash where
  // items disappear then reappear; the server enforces the real boundary.
  function isModuleEnabled(key: string): boolean {
    if (!enabledModules) return true;
    return enabledModules.has(key);
  }

  return { isModuleEnabled, loading: enabledModules === null };
}
