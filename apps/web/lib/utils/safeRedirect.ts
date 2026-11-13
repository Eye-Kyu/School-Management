/**
 * SA-25 (security audit 2026-11): the login page's ?next= parameter went
 * straight into router.push, which gave an open redirect after sign-in and
 * could run a javascript: URL in the SKULI origin.
 *
 * Returns the value only when it is a same-origin relative path
 * ("/teacher/quizzes?x=1"), otherwise null. Rejects absolute URLs, any
 * scheme (javascript:, data:, https:), protocol-relative "//host" and
 * backslash variants ("/\\host"), and control characters.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('\\')) return null;
  try {
    // Resolve against a dummy origin: if the origin changes, the input escaped.
    const url = new URL(value, 'https://skuli.invalid');
    if (url.origin !== 'https://skuli.invalid') return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
