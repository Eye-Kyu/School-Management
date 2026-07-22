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

// Object.groupBy is ES2024 (Node >= 21) — this repo's deployed runtime is
// Node 20, so it must not be used in Server Components.
export function groupByDay<T extends { day_of_week: string }>(items: T[]): Record<string, T[]> {
  return items.reduce((acc, item) => {
    (acc[item.day_of_week] ??= []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

export function formatTime(t: string) {
  // 'HH:MM' → '8:30 AM'
  const [h, m] = t.split(':').map(Number);
  const ampm = (h ?? 0) >= 12 ? 'PM' : 'AM';
  const h12 = (h ?? 0) % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
