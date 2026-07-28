// =============================================================================
// @school-manager/types
// =============================================================================
// Single source of truth for all shapes that cross the network boundary.
// Used by both the web app (apps/web) and the API (apps/api).
//
// Rules:
//   1. Define every schema with Zod.
//   2. Export the Zod object AND the inferred TS type with the same name
//      (using TypeScript declaration merging).
//   3. Never import from @prisma/client here - this package must work in
//      browser environments too.
// =============================================================================

export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/school';
export * from './schemas/user';
export * from './schemas/class';
export * from './schemas/department';
export * from './schemas/behaviour';
export * from './schemas/timetable';
export * from './schemas/attendance';
export * from './schemas/fees';
export * from './schemas/announcement';
export * from './schemas/assessments';
export * from './schemas/event';
export * from './schemas/homework';
export * from './schemas/messaging';
export * from './schemas/package';
export * from './schemas/curriculum';
export * from './schemas/privileged-access';
export * from './schemas/audit-log';
export * from './schemas/billing';
export * from './schemas/platform-users';
export * from './schemas/platform-message';
export * from './schemas/assist-mode';
export * from './schemas/prefect';
export * from './grading';
