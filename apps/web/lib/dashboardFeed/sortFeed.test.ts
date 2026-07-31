import { describe, it, expect } from 'vitest';
import { sortFeed } from './sortFeed';
import type { FeedEntry } from './types';

function entry(overrides: Partial<FeedEntry>): FeedEntry {
  return { id: 'x', source: 'alerts', title: 'T', body: 'B', timestamp: '', isRead: false, href: '/', ...overrides };
}

describe('sortFeed', () => {
  it('sorts all unread items before all read items', () => {
    const result = sortFeed([
      entry({ id: 'read-1', isRead: true, timestamp: '2026-01-05T00:00:00Z' }),
      entry({ id: 'unread-1', isRead: false, timestamp: '2026-01-01T00:00:00Z' }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['unread-1', 'read-1']);
  });

  it('sorts newest-first within the unread group', () => {
    const result = sortFeed([
      entry({ id: 'older', isRead: false, timestamp: '2026-01-01T00:00:00Z' }),
      entry({ id: 'newer', isRead: false, timestamp: '2026-01-10T00:00:00Z' }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('sorts newest-first within the read group', () => {
    const result = sortFeed([
      entry({ id: 'older', isRead: true, timestamp: '2026-01-01T00:00:00Z' }),
      entry({ id: 'newer', isRead: true, timestamp: '2026-01-10T00:00:00Z' }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('items with no timestamp sort last within their group, not first', () => {
    const result = sortFeed([
      entry({ id: 'no-date', isRead: false, timestamp: '' }),
      entry({ id: 'has-date', isRead: false, timestamp: '2026-01-01T00:00:00Z' }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['has-date', 'no-date']);
  });

  it('does not mutate the input array', () => {
    const input = [entry({ id: 'a', isRead: true }), entry({ id: 'b', isRead: false })];
    const original = [...input];
    sortFeed(input);
    expect(input).toEqual(original);
  });
});
