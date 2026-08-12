'use client';

// =============================================================================
// Before adding a new posthog.capture()/identify() call anywhere in this
// app: read docs/audits/posthog-capture-audit.md first. No direct PII
// (student_id, admission_number, student_name, parent/guardian name, email,
// phone_number) may appear in event properties — hash identify/distinctId
// values via lib/analytics/anonymize.ts's hashForAnalytics() (server-only;
// see that file's own header for why), and mask any ID that could appear in
// a URL via lib/analytics/maskUrl.ts's maskDynamicSegments(). Env var setup
// (Vercel + local) is documented in apps/web/README-POSTHOG.md.
//
// Not currently rendered anywhere in the app (confirmed by grep) — kept
// correct for whenever it is, rather than left as a PII-leaking template to
// copy from. Fetches its own hashed identity rather than taking a raw
// userId/role as props, for the same reason login/page.tsx does (see that
// file's identifyForAnalytics()).
// =============================================================================

import { useEffect } from 'react';
import posthog from 'posthog-js';

export default function PostHogIdentify() {
  useEffect(() => {
    let cancelled = false;
    fetch('/api/analytics/identity')
      .then((r) => (r.ok ? r.json() : null))
      .then((identity: { hashedId: string; role: string; schoolId: string } | null) => {
        if (!cancelled && identity) {
          posthog.identify(identity.hashedId, { role: identity.role, school_id: identity.schoolId });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return null;
}
