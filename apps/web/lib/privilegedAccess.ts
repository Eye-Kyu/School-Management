// =============================================================================
// Shared privileged-access types + a tiny same-tab event bus.
// =============================================================================
// Grant creation/ending happens from several different pages (school detail,
// scoped viewer), while the global banner lives in SuperAdminShell. Rather
// than lifting all grant state into a context, mutating pages just dispatch
// this event after a successful create/end and the shell (and any other
// listener) refetches. Combined with a slow poll as a fallback.
// =============================================================================

export const PRIVILEGED_ACCESS_CHANGED_EVENT = 'privileged-access:changed';

export function notifyPrivilegedAccessChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PRIVILEGED_ACCESS_CHANGED_EVENT));
}

export type PrivilegedAccessScope =
  | 'SCHOOL_AGGREGATES'
  | 'STUDENT_RECORDS'
  | 'ACADEMIC_DATA'
  | 'ATTENDANCE'
  | 'FINANCIAL_DATA'
  | 'COMMUNICATION'
  | 'DOCUMENTS';

export const PRIVILEGED_ACCESS_WIRED_SCOPES: PrivilegedAccessScope[] = [
  'SCHOOL_AGGREGATES',
  'STUDENT_RECORDS',
  'ACADEMIC_DATA',
  'ATTENDANCE',
  'FINANCIAL_DATA',
  'COMMUNICATION',
  'DOCUMENTS',
];

export const PRIVILEGED_ACCESS_SCOPE_LABELS: Record<PrivilegedAccessScope, string> = {
  SCHOOL_AGGREGATES: 'School aggregates',
  STUDENT_RECORDS: 'Student records',
  ACADEMIC_DATA: 'Academic data',
  ATTENDANCE: 'Attendance',
  FINANCIAL_DATA: 'Financial data',
  COMMUNICATION: 'Communication',
  DOCUMENTS: 'Documents',
};

export type PrivilegedAccessGrant = {
  id: string;
  superAdminUserId: string;
  targetSchoolId: string;
  schoolName: string | null;
  reason: string;
  reference: string | null;
  accessLevel: 'READ_ONLY' | 'READ_WRITE';
  scopes: PrivilegedAccessScope[];
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  expiresAt: string;
  endedAt: string | null;
  createdAt: string;
};

export function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
