// Resolves "today" in a school's own timezone rather than the server's or
// browser's — needed so a midnight boundary (e.g. for the teacher daily
// checklist) matches the school's local day, not wherever the code runs.

const WEEKDAY_TO_ENUM: Record<string, string> = {
  Monday: 'MONDAY', Tuesday: 'TUESDAY', Wednesday: 'WEDNESDAY',
  Thursday: 'THURSDAY', Friday: 'FRIDAY', Saturday: 'SATURDAY', Sunday: 'SUNDAY',
};

export function schoolLocalDateParts(timezone: string, now: Date = new Date()): { dateIso: string; dayEnum: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    }).formatToParts(now);
  } catch {
    // Unknown/invalid timezone string — fall back to the default rather than throwing.
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    }).formatToParts(now);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const dateIso = `${get('year')}-${get('month')}-${get('day')}`;
  const dayEnum = WEEKDAY_TO_ENUM[get('weekday')] ?? 'MONDAY';
  return { dateIso, dayEnum };
}
