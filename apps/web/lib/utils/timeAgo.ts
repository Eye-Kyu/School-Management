// Extracted from a duplicated inline copy in FeedCard.tsx and
// NotificationsView.tsx (both had the identical function) — Student 360's
// header "Last updated" indicator is a third call site, past the point
// where copy-pasting a fourth time was worth it. Pure Date math, safe to
// call from both server and client components.
export function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}
