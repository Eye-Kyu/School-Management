export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;
export type Day = typeof DAYS[number];

export const DAY_LABELS: Record<Day, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed',
  THURSDAY: 'Thu', FRIDAY: 'Fri',
};

const JS_DAY_TO_ENUM: Record<number, string> = {
  1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY',
  4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY', 0: 'SUNDAY',
};

export function todayEnum(): string {
  return JS_DAY_TO_ENUM[new Date().getDay()] ?? 'MONDAY';
}

export function formatTime(t: string) {
  // 'HH:MM' → '8:30 AM'
  const [h, m] = t.split(':').map(Number);
  const ampm = (h ?? 0) >= 12 ? 'PM' : 'AM';
  const h12 = (h ?? 0) % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
