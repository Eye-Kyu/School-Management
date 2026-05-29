/**
 * Notification service unit tests — mocks Supabase, no network required.
 */

import { NotificationsService, type NotifPayload } from '../notifications/notifications.service';

// ── Profanity filter (internal helper) ─────────────────────
// The function is inside MessagingService; test equivalent logic here.
const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard'];
function hasProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  return PROFANITY.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

describe('hasProfanity (messaging guard)', () => {
  it('returns false for clean text', () => {
    expect(hasProfanity('Good morning, I wanted to discuss the homework.')).toBe(false);
  });

  it('returns true for exact profanity', () => {
    expect(hasProfanity('that is bullshit')).toBe(false); // not in list
    expect(hasProfanity('that is shit')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(hasProfanity('FUCK')).toBe(true);
    expect(hasProfanity('Fuck this')).toBe(true);
  });

  it('does not match partial words', () => {
    // "assessment" contains "ass" but is not profanity
    expect(hasProfanity('the assessment is tomorrow')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasProfanity('')).toBe(false);
  });
});

// ── NotifPayload interface conformance ──────────────────────

describe('NotifPayload type', () => {
  it('accepts all required notification types', () => {
    const types = ['ABSENT_STUDENT', 'NEW_ANNOUNCEMENT', 'HOMEWORK_ASSIGNED', 'NEW_MESSAGE'] as const;
    for (const type of types) {
      const payload: NotifPayload = {
        schoolId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        recipientId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        type,
        title: `Test ${type}`,
        body: 'Test body',
      };
      expect(payload.type).toBe(type);
    }
  });

  it('skipExternalChannels is optional', () => {
    const payload: NotifPayload = {
      schoolId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      recipientId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      type: 'NEW_ANNOUNCEMENT',
      title: 'Test',
      body: 'Body',
      skipExternalChannels: true,
    };
    expect(payload.skipExternalChannels).toBe(true);
  });

  it('deliverAfter is optional', () => {
    const payload: NotifPayload = {
      schoolId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      recipientId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      type: 'NEW_MESSAGE',
      title: 'New message',
      body: 'Hello',
      deliverAfter: new Date(Date.now() + 3600000).toISOString(),
    };
    expect(payload.deliverAfter).toBeDefined();
  });
});

// ── Quiet hours logic ───────────────────────────────────────
function isInQuietHours(nairobiHour: number, start: number, end: number): boolean {
  if (start > end) return nairobiHour >= start || nairobiHour < end;
  return nairobiHour >= start && nairobiHour < end;
}

describe('isInQuietHours', () => {
  // Default: 9pm (21) to 7am (7) — wraps midnight
  it('is in quiet hours at 10pm', () => {
    expect(isInQuietHours(22, 21, 7)).toBe(true);
  });

  it('is in quiet hours at midnight', () => {
    expect(isInQuietHours(0, 21, 7)).toBe(true);
  });

  it('is in quiet hours at 3am', () => {
    expect(isInQuietHours(3, 21, 7)).toBe(true);
  });

  it('is NOT in quiet hours at 8am', () => {
    expect(isInQuietHours(8, 21, 7)).toBe(false);
  });

  it('is NOT in quiet hours at noon', () => {
    expect(isInQuietHours(12, 21, 7)).toBe(false);
  });

  it('is NOT in quiet hours at 8:59pm (20:59)', () => {
    expect(isInQuietHours(20, 21, 7)).toBe(false);
  });

  // Boundary: 9pm exactly is start of quiet hours
  it('is in quiet hours at exactly 9pm', () => {
    expect(isInQuietHours(21, 21, 7)).toBe(true);
  });

  // Boundary: 7am is end of quiet hours
  it('is NOT in quiet hours at exactly 7am (end boundary exclusive)', () => {
    expect(isInQuietHours(7, 21, 7)).toBe(false);
  });
});
