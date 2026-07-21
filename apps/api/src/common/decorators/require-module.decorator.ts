// =============================================================================
// @RequireModule(key) - gate a route behind a school's module entitlement
// =============================================================================
// Usage:
//   @UseGuards(AuthGuard, FeatureGuard)
//   @RequireModule('ai_features')
//   @Post('generate-quiz')
//   handler() { ... }
//
// This is a fast-fail UX layer only — the actual security boundary is the
// matching module_enabled() check folded into RLS policies (see
// supabase/migrations/20260721000024_module_enforcement_rls.sql). A route
// with no @RequireModule is treated as core/always-on.
// =============================================================================

import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MODULE_KEY = 'requireModule';

export type ModuleKey =
  | 'payments'
  | 'assessments'
  | 'ai_features'
  | 'api_webhooks'
  | 'homework'
  | 'events';

export const RequireModule = (key: ModuleKey) => SetMetadata(REQUIRE_MODULE_KEY, key);
