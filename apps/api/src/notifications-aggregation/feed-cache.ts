import type { DashboardFeedResponse } from './feed.types';

// Plain module-level singleton — deliberately NOT a NestJS provider. No
// caching infra exists anywhere in this repo (Upstash env vars are empty
// v0.2+ placeholders) and the API runs as a single instance (plain `node
// dist/main.js`, no cluster/PM2 config), so an in-memory Map with a TTL is
// right-sized. Being a plain module import (not DI-managed) is the point:
// any service — NotificationsService.markRead, MessagingService.markRead,
// PaybillReconciliationService.manualMatch — can invalidate a user's cache
// entry with a plain import, without needing to inject
// NotificationsAggregationService (which would reintroduce the circular
// module dependency this module was built to avoid). Move to Redis only if
// the API is ever horizontally scaled.
const TTL_MS = 60_000;

const cache = new Map<string, { expiresAt: number; data: DashboardFeedResponse }>();

export function getCachedFeed(userId: string): DashboardFeedResponse | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.data;
}

export function setCachedFeed(userId: string, data: DashboardFeedResponse): void {
  cache.set(userId, { expiresAt: Date.now() + TTL_MS, data });
}

export function invalidateUserFeedCache(userId: string): void {
  cache.delete(userId);
}
