import { SetMetadata } from '@nestjs/common';
import type { PrivilegedAccessScope } from '@school-manager/types';

export const ASSIST_SCOPE_KEY = 'assistScope';

/**
 * Marks a mutating endpoint as assist-mode-aware: when the caller has an
 * active req.assistContext (see AuthGuard), AssistScopeGuard requires this
 * scope to be present on the underlying grant — reusing the same
 * PrivilegedAccessScope enum as the read-only viewer, so one grant covers
 * both. Endpoints with NO assist context at all are unaffected (normal
 * role/RLS checks apply as before).
 */
export const RequireAssistScope = (scope: PrivilegedAccessScope) => SetMetadata(ASSIST_SCOPE_KEY, scope);
