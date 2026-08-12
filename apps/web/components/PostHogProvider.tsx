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
// =============================================================================

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import { maskDynamicSegments } from '@/lib/analytics/maskUrl';

if (typeof window !== 'undefined') {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NODE_ENV !== 'production') {
    console.error('NEXT_PUBLIC_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_KEY is configured');
  }
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      // Routed through the /ingest rewrite in next.config.js (rewrites()),
      // rather than hitting PostHog's host directly — avoids ad-blockers/
      // ISP-level blocking of third-party analytics domains. NOT provided
      // by withPostHogConfig itself — that wrapper only handles source-map
      // upload (confirmed by reading its source); the rewrite is this
      // repo's own addition.
      api_host: '/ingest',
      ui_host: 'https://eu.posthog.com',
      defaults: '2026-01-30',
      capture_pageview: false, // handled manually below
      capture_pageleave: true,
      capture_exceptions: true,
      person_profiles: 'identified_only',
      debug: process.env.NODE_ENV === 'development',
    });
  }
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    ph?.capture('$pageview', { $current_url: maskDynamicSegments(window.location.href) });
  }, [pathname, searchParams, ph]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}
