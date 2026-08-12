// =============================================================================
// maskDynamicSegments — client-safe URL scrubbing for PostHog $pageview.
// =============================================================================
// Deliberately kept in its own file, separate from anonymize.ts: that file
// imports Node's `crypto` module and cannot be bundled into client code.
// This one is a pure regex replace, safe to import from PostHogProvider.tsx.
//
// Replaces any UUID-shaped path segment with `:id` before the URL is sent to
// PostHog — e.g. a real student ID in /students/<uuid>/360 becomes
// /students/:id/360. Generic by design: covers every dynamic-ID route (quiz,
// assessment, permission slip, student, etc.) without per-route knowledge,
// so a future route with an ID in its path is covered automatically.
// =============================================================================

const UUID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function maskDynamicSegments(url: string): string {
  return url.replace(UUID_SEGMENT, ':id');
}
