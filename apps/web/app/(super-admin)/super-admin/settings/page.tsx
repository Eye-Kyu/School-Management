import { redirect } from 'next/navigation';

// Platform Settings was merged into System Health's Configuration tab
// (Bucket 1, PR 1) — this route stays only to redirect old bookmarks/links.
// Matches the only existing redirect precedent in this codebase
// ((super-admin)/layout.tsx's auth-gate redirect() calls) rather than
// introducing next.config.js redirects or middleware for one case.
export default function PlatformSettingsRedirect() {
  redirect('/super-admin/system-health?tab=configuration');
}
