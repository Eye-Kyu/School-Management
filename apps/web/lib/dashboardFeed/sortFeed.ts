import type { FeedEntry } from './types';

/**
 * Unread items sort before all read items; newest-first within each group.
 * Items with no timestamp (some reminders have no specific due date) sort
 * last within their group rather than throwing on an invalid Date.
 */
export function sortFeed(entries: FeedEntry[]): FeedEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    const at = a.timestamp ? new Date(a.timestamp).getTime() : -Infinity;
    const bt = b.timestamp ? new Date(b.timestamp).getTime() : -Infinity;
    return bt - at;
  });
}
