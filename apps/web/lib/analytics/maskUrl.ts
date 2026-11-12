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

// =============================================================================
// scrubAnalyticsEvent — PostHog `before_send` hook (security audit SA-46).
// =============================================================================
// The manual $pageview above was the only masked event. The SDK also fills
// $current_url/$pathname/$referrer (and their $initial_* person-property
// twins) on every event it sends: $pageleave, $autocapture, $exception and
// custom captures. Autocapture additionally records clicked links' hrefs in
// $elements / $elements_chain. This hook masks UUIDs in all of those before
// anything leaves the browser. Element text and attributes are separately
// switched off with mask_all_text / mask_all_element_attributes in init().
// =============================================================================

const URL_PROPERTY_KEYS = [
  '$current_url', '$pathname', '$referrer', '$prev_pageview_pathname',
  '$initial_current_url', '$initial_pathname', '$initial_referrer',
] as const;

type EventLike = {
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
} | null;

function maskUrlProps(props: Record<string, unknown> | undefined): void {
  if (!props) return;
  for (const key of URL_PROPERTY_KEYS) {
    const v = props[key];
    if (typeof v === 'string') props[key] = maskDynamicSegments(v);
  }
  if (typeof props.$elements_chain === 'string') {
    props.$elements_chain = maskDynamicSegments(props.$elements_chain);
  }
  if (Array.isArray(props.$elements)) {
    for (const el of props.$elements as Array<Record<string, unknown>>) {
      if (el && typeof el.attr__href === 'string') el.attr__href = maskDynamicSegments(el.attr__href);
      if (el && typeof el.href === 'string') el.href = maskDynamicSegments(el.href);
    }
  }
}

export function scrubAnalyticsEvent<T extends EventLike>(event: T): T {
  if (!event) return event;
  maskUrlProps(event.properties);
  maskUrlProps(event.$set);
  maskUrlProps(event.$set_once);
  return event;
}
