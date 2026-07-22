import { z } from 'zod';

// =============================================================================
// Privileged tenant access - explicit, scoped, time-limited grants letting a
// SUPER_ADMIN read into one school's tenant data for support/troubleshooting.
// Never a standing backdoor: every grant has a reason, an expiry, a fixed set
// of scopes, and every scoped read it enables is written to
// privileged_access_logs. All 7 scopes have a real viewer wired up. COMMUNICATION
// is metadata-only (conversation participants/timestamps/flags) - message body
// text is never exposed through this mechanism, a deliberate exception to the
// "mirror the tenant query shape exactly" rule the other 6 scopes follow.
// =============================================================================

export const PrivilegedAccessScope = z.enum([
  'SCHOOL_AGGREGATES',
  'STUDENT_RECORDS',
  'ACADEMIC_DATA',
  'ATTENDANCE',
  'FINANCIAL_DATA',
  'COMMUNICATION',
  'DOCUMENTS',
]);
export type PrivilegedAccessScope = z.infer<typeof PrivilegedAccessScope>;

export const PRIVILEGED_ACCESS_WIRED_SCOPES: PrivilegedAccessScope[] = [
  'SCHOOL_AGGREGATES',
  'STUDENT_RECORDS',
  'ACADEMIC_DATA',
  'ATTENDANCE',
  'FINANCIAL_DATA',
  'COMMUNICATION',
  'DOCUMENTS',
];

export const PrivilegedAccessLevel = z.enum(['READ_ONLY', 'READ_WRITE']);
export type PrivilegedAccessLevel = z.infer<typeof PrivilegedAccessLevel>;

export const PrivilegedAccessGrantStatus = z.enum(['ACTIVE', 'ENDED', 'EXPIRED']);
export type PrivilegedAccessGrantStatus = z.infer<typeof PrivilegedAccessGrantStatus>;

export const CreatePrivilegedAccessGrantInput = z.object({
  schoolId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
  reference: z.string().max(200).optional(),
  scopes: z.array(PrivilegedAccessScope).min(1),
  durationMinutes: z.number().int().min(1).max(24 * 60).default(60),
});
export type CreatePrivilegedAccessGrantInput = z.infer<typeof CreatePrivilegedAccessGrantInput>;
