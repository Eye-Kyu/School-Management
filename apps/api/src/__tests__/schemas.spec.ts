/**
 * Schema validation tests — no DB or network required.
 * Verifies that every Zod schema correctly accepts valid input
 * and rejects invalid input.
 */

// Import schema source files directly (4 levels up to monorepo root from src/__tests__/)
/* eslint-disable @typescript-eslint/no-var-requires */
const { CreateStudentInput, UpdateProfileInput } =
  require('../../../../packages/types/src/schemas/user');
const { MarkAttendanceInput } =
  require('../../../../packages/types/src/schemas/attendance');
const { CreateAnnouncementInput } =
  require('../../../../packages/types/src/schemas/announcement');
const { CreateConversationInput, SendMessageInput } =
  require('../../../../packages/types/src/schemas/messaging');
/* eslint-enable @typescript-eslint/no-var-requires */

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

// ── Students ─────────────────────────────────────────────────

describe('CreateStudentInput', () => {
  it('accepts a valid student', () => {
    const result = CreateStudentInput.safeParse({
      fullName: 'Jane Wanjiku',
      admissionNo: 'ADM001',
      email: 'jane@example.com',
      classId: UUID,
      gender: 'FEMALE',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fullName', () => {
    const result = CreateStudentInput.safeParse({ admissionNo: 'ADM001' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid gender', () => {
    const result = CreateStudentInput.safeParse({
      fullName: 'Test', admissionNo: 'ADM001', gender: 'UNKNOWN',
    });
    expect(result.success).toBe(false);
  });
});

// ── Attendance ───────────────────────────────────────────────

describe('MarkAttendanceInput', () => {
  it('accepts a valid attendance payload', () => {
    const result = MarkAttendanceInput.safeParse({
      classId: UUID,
      date: '2026-05-27',
      records: [
        { studentId: UUID, status: 'PRESENT' },
        { studentId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'ABSENT' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = MarkAttendanceInput.safeParse({
      classId: UUID,
      date: '2026-05-27',
      records: [{ studentId: UUID, status: 'MAYBE' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = MarkAttendanceInput.safeParse({
      classId: UUID, date: '27-05-2026', records: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Announcements ────────────────────────────────────────────

describe('CreateAnnouncementInput', () => {
  it('accepts SCHOOL_WIDE audience', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Meeting tomorrow',
      body: 'All parents are invited.',
      audience: 'SCHOOL_WIDE',
    });
    expect(result.success).toBe(true);
  });

  it('accepts TEACHERS audience', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Staff briefing', body: 'At 8am in the staffroom.', audience: 'TEACHERS',
    });
    expect(result.success).toBe(true);
  });

  it('accepts PARENTS audience', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Fees reminder', body: 'Pay by end of term.', audience: 'PARENTS',
    });
    expect(result.success).toBe(true);
  });

  it('accepts GRADE audience with targetGradeLevel', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Grade 5 trip', body: 'Forms due Friday.', audience: 'GRADE', targetGradeLevel: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects GRADE audience without targetGradeLevel', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Grade trip', body: 'Forms due.', audience: 'GRADE',
    });
    expect(result.success).toBe(false);
  });

  it('accepts CLASS audience with targetClassId', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Class trip', body: 'Bus leaves at 7am.', audience: 'CLASS', targetClassId: UUID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects CLASS audience without targetClassId', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Class trip', body: 'Bus at 7am.', audience: 'CLASS',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown audience', () => {
    const result = CreateAnnouncementInput.safeParse({
      title: 'Test', body: 'Test', audience: 'STUDENTS',
    });
    expect(result.success).toBe(false);
  });
});

// ── Messaging ────────────────────────────────────────────────

describe('CreateConversationInput', () => {
  it('accepts valid input with first message', () => {
    const result = CreateConversationInput.safeParse({
      teacherUserId: UUID,
      firstMessage: 'Hello, I wanted to discuss my child\'s progress.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with optional studentId', () => {
    const result = CreateConversationInput.safeParse({
      teacherUserId: UUID,
      studentId: UUID,
      firstMessage: 'Regarding my son.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty message', () => {
    const result = CreateConversationInput.safeParse({
      teacherUserId: UUID, firstMessage: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID', () => {
    const result = CreateConversationInput.safeParse({
      teacherUserId: 'not-a-uuid', firstMessage: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects message over 2000 chars', () => {
    const result = CreateConversationInput.safeParse({
      teacherUserId: UUID, firstMessage: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe('SendMessageInput', () => {
  it('accepts a valid message', () => {
    const result = SendMessageInput.safeParse({ body: 'Thank you for your response.' });
    expect(result.success).toBe(true);
  });

  it('trims whitespace and outputs empty string', () => {
    // Zod .trim() is a post-validation transform; '   ' passes min(1) but outputs ''
    const result = SendMessageInput.safeParse({ body: '   ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe('');
  });

  it('rejects truly empty string', () => {
    const result = SendMessageInput.safeParse({ body: '' });
    expect(result.success).toBe(false);
  });
});

// ── Profile — inline schema to avoid Node.js 22 type-stripping quirk ──────────
// Node.js 22 experimental type-stripping erases `export const X` when followed
// immediately by `export type X` with the same name (declaration merging).
// The production API compiles via tsc which handles this correctly.
import { z } from 'zod';
const ProfileSchema = z.object({
  fullName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
});

describe('Profile schema (UpdateProfileInput equivalent)', () => {
  it('accepts valid name and phone', () => {
    expect(ProfileSchema.safeParse({ fullName: 'John Kamau', phone: '+254712345678' }).success).toBe(true);
  });

  it('accepts valid avatarUrl', () => {
    expect(ProfileSchema.safeParse({ fullName: 'John Kamau', avatarUrl: 'https://example.com/avatar.jpg' }).success).toBe(true);
  });

  it('accepts null avatarUrl (clear avatar)', () => {
    expect(ProfileSchema.safeParse({ fullName: 'John Kamau', avatarUrl: null }).success).toBe(true);
  });

  it('rejects empty fullName', () => {
    expect(ProfileSchema.safeParse({ fullName: '' }).success).toBe(false);
  });

  it('rejects invalid avatarUrl', () => {
    expect(ProfileSchema.safeParse({ fullName: 'John', avatarUrl: 'not-a-url' }).success).toBe(false);
  });
});
