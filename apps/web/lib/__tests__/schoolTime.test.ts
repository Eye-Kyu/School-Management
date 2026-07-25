import { describe, it, expect } from 'vitest';
import { schoolLocalDateParts } from '../utils/schoolTime';

describe('schoolLocalDateParts', () => {
  it('returns an ISO date and an uppercase weekday enum', () => {
    const { dateIso, dayEnum } = schoolLocalDateParts('Africa/Nairobi', new Date('2026-07-23T10:00:00Z'));
    expect(dateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']).toContain(dayEnum);
  });

  it('resolves the correct local date near a UTC day boundary', () => {
    // 23:30 UTC on 2026-07-22 is already 2026-07-23 02:30 in Nairobi (UTC+3).
    const { dateIso, dayEnum } = schoolLocalDateParts('Africa/Nairobi', new Date('2026-07-22T23:30:00Z'));
    expect(dateIso).toBe('2026-07-23');
    expect(dayEnum).toBe('THURSDAY');
  });

  it('falls back to Africa/Nairobi for an invalid timezone instead of throwing', () => {
    expect(() => schoolLocalDateParts('Not/A_Zone', new Date('2026-07-23T10:00:00Z'))).not.toThrow();
    const { dateIso } = schoolLocalDateParts('Not/A_Zone', new Date('2026-07-23T10:00:00Z'));
    expect(dateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
