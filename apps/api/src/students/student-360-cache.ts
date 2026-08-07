import type { Student360Data } from './student-360.types';

// Plain module-level singleton, mirroring
// apps/api/src/notifications-aggregation/feed-cache.ts exactly — same
// reasoning applies (single-instance deployment, no Redis/Upstash
// configured, avoids a DI/circular-module dependency). Keyed per
// (studentId, termId), NOT per viewer — a cache hit is legitimately shared
// across every authorized viewer of the same student. This means the
// access check and the audit-log write in Student360Service must run
// unconditionally on every request, before this cache is even consulted —
// this module only ever short-circuits the data-aggregation step.
const TTL_MS = 300_000; // 5 minutes, per the task spec

interface CacheEntry {
  expiresAt: number;
  // When the underlying numbers were actually computed — surfaced to the
  // caller as metadata.aggregated_at even on a cache hit, so "Last updated"
  // on the page reflects real data freshness, not request time.
  aggregatedAt: string;
  data: Student360Data;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(studentId: string, termId: string): string {
  return `student-360:${studentId}:${termId}`;
}

export function getCachedStudent360(studentId: string, termId: string): { data: Student360Data; aggregatedAt: string } | null {
  const key = cacheKey(studentId, termId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data, aggregatedAt: entry.aggregatedAt };
}

export function setCachedStudent360(studentId: string, termId: string, data: Student360Data, aggregatedAt: string): void {
  cache.set(cacheKey(studentId, termId), { expiresAt: Date.now() + TTL_MS, aggregatedAt, data });
}
