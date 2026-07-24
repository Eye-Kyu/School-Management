import { z } from 'zod';
import { Uuid } from './common';

// =============================================================================
// SuperAdmin assist-mode JWT claims — shared shape between apps/api (mints,
// verifies for NestJS-mediated writes) and apps/web (verifies for direct
// Supabase reads + middleware routing + the banner). Cookie itself is
// deliberately NOT httpOnly: apps/web and apps/api are different origins, and
// apiFetch already forwards the Supabase session as an explicit Authorization
// header rather than relying on cross-origin cookies — this follows the same
// pattern via an X-Assist-Token header, which requires the cookie to be
// readable by client JS. Matches this app's existing posture (the Supabase
// session itself is already client-JS-readable via @supabase/ssr).
// =============================================================================

export const ASSIST_MODE_COOKIE = 'sm_assist';

export const AssistModeClaims = z.object({
  superAdminUserId: Uuid,
  targetSchoolId: Uuid,
  accessGrantId: Uuid,
  grantedScopes: z.array(z.string()),
});
export type AssistModeClaims = z.infer<typeof AssistModeClaims>;
