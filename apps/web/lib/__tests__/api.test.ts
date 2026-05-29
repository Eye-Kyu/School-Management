/**
 * Tests for pure logic functions extracted from the web app.
 * No Supabase / network calls needed.
 */
import { describe, it, expect } from 'vitest';

// ── apiFetch error message extraction ────────────────────────
function extractMessage(text: string, status: number, statusText: string): string {
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep as text */ }
  const msg = (body as Record<string, unknown>)?.message;
  return typeof msg === 'string'
    ? msg
    : Array.isArray(msg)
    ? (msg as string[]).join('; ')
    : text || `${status}: ${statusText}`;
}

describe('apiFetch error message extraction', () => {
  it('extracts string message from JSON body', () => {
    expect(extractMessage('{"message":"Validation failed"}', 400, 'Bad Request')).toBe('Validation failed');
  });

  it('joins array messages', () => {
    expect(
      extractMessage('{"message":["Field A is required","Field B is invalid"]}', 400, 'Bad Request'),
    ).toBe('Field A is required; Field B is invalid');
  });

  it('falls back to plain text', () => {
    expect(extractMessage('Internal Server Error', 500, 'ISE')).toBe('Internal Server Error');
  });

  it('uses status:statusText for empty body', () => {
    expect(extractMessage('', 404, 'Not Found')).toBe('404: Not Found');
  });
});

// ── Grade letter ──────────────────────────────────────────────
function gradeLetter(pct: number) {
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'E';
}

describe('gradeLetter (report card)', () => {
  it.each([
    [100, 'A'], [80, 'A'], [79, 'B'], [70, 'B'],
    [69, 'C'], [60, 'C'], [59, 'D'], [50, 'D'],
    [49, 'E'], [0, 'E'],
  ])('%d% → %s', (pct, expected) => {
    expect(gradeLetter(pct)).toBe(expected);
  });
});

// ── Notification grouping ─────────────────────────────────────
function groupByDay(items: { created_at: string }[]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups = [
    { label: 'Today', items: [] as typeof items },
    { label: 'Yesterday', items: [] as typeof items },
    { label: 'Earlier', items: [] as typeof items },
  ];
  for (const n of items) {
    const d = new Date(n.created_at).toDateString();
    const bucket = d === today ? groups[0] : d === yesterday ? groups[1] : groups[2];
    bucket!.items.push(n);
  }
  return groups.filter((g) => g.items.length > 0);
}

describe('groupByDay (notifications)', () => {
  it('groups today under Today', () => {
    const groups = groupByDay([{ created_at: new Date().toISOString() }]);
    expect(groups[0]?.label).toBe('Today');
    expect(groups[0]?.items.length).toBe(1);
  });

  it('returns empty for no items', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('groups 3-day-old item under Earlier', () => {
    const old = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(groupByDay([{ created_at: old }])[0]?.label).toBe('Earlier');
  });

  it('separates today and earlier correctly', () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 5 * 86400000).toISOString();
    const groups = groupByDay([{ created_at: now }, { created_at: old }]);
    expect(groups.length).toBe(2);
    expect(groups[0]?.label).toBe('Today');
    expect(groups[1]?.label).toBe('Earlier');
  });
});

// ── Submission rate ───────────────────────────────────────────
describe('submission rate calculation', () => {
  function subRate(submitted: number, total: number): number | null {
    return total > 0 ? (submitted / total) * 100 : null;
  }

  it('returns 100 when all submitted', () => expect(subRate(5, 5)).toBe(100));
  it('returns 50 for half submitted', () => expect(subRate(3, 6)).toBe(50));
  it('returns null for zero total', () => expect(subRate(0, 0)).toBeNull());
  it('returns 0 for none submitted', () => expect(subRate(0, 10)).toBe(0));
});
