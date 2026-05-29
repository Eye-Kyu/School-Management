/**
 * Day utilities tests.
 */
import { describe, it, expect } from 'vitest';
import { formatTime, DAY_LABELS, DAYS } from '../utils/days';

describe('formatTime', () => {
  it('formats HH:MM:SS as HH:MM', () => {
    expect(formatTime('09:30:00')).toMatch(/9:30|09:30/);
  });

  it('formats midnight', () => {
    expect(formatTime('00:00:00')).toMatch(/12:00|00:00/);
  });
});

describe('DAY_LABELS', () => {
  it('has labels for all 5 weekdays', () => {
    expect(Object.keys(DAY_LABELS).length).toBeGreaterThanOrEqual(5);
  });

  it('labels are non-empty strings', () => {
    for (const label of Object.values(DAY_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('DAYS array', () => {
  it('contains 5 weekday entries', () => {
    expect(DAYS.length).toBe(5);
  });

  it('values match DAY_LABELS keys', () => {
    for (const d of DAYS) {
      expect(DAY_LABELS[d]).toBeDefined();
    }
  });
});
