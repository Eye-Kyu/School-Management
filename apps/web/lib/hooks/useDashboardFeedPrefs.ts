'use client';

// =============================================================================
// useDashboardFeedPrefs - filter chip + compact/comfortable toggle, persisted
// =============================================================================
// No shared localStorage hook exists in this codebase yet — the one
// precedent (LeaderboardClient.tsx's `leaderboard-prefs` key) is a single
// global key, not scoped per user, which would collide across accounts on a
// shared browser. Built fresh here with a user+role-scoped key instead,
// rather than retrofitting that existing one (out of scope for this PR).
// =============================================================================

import { useEffect, useState } from 'react';

export type FeedFilter = 'all' | 'alerts' | 'conversations' | 'reminders';
export type FeedDensity = 'compact' | 'comfortable';

type FeedPrefs = { filter: FeedFilter; density: FeedDensity };

const DEFAULT_PREFS: FeedPrefs = { filter: 'all', density: 'comfortable' };

function storageKey(userId: string, role: string): string {
  return `dashboard-feed-prefs:${userId}:${role}`;
}

export function useDashboardFeedPrefs(userId: string, role: string) {
  const key = storageKey(userId, role);
  const [prefs, setPrefs] = useState<FeedPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {
      // Malformed/inaccessible storage — fall back to defaults silently.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function update(patch: Partial<FeedPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage unavailable (private browsing, quota) — in-memory state still updates.
      }
      return next;
    });
  }

  return {
    filter: prefs.filter,
    density: prefs.density,
    setFilter: (filter: FeedFilter) => update({ filter }),
    setDensity: (density: FeedDensity) => update({ density }),
  };
}
