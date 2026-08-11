// Small date helpers — term date range + weekday enumeration for attendance.

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** All weekdays (Mon-Fri) between start and end inclusive, as YYYY-MM-DD strings. */
export function weekdaysInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.getUTCDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) out.push(toDateStr(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}
