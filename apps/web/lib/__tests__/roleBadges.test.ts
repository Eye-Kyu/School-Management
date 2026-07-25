import { describe, it, expect } from 'vitest';
import { BADGE_VARIANTS } from '@school-manager/ui';

describe('role badge variants', () => {
  const roleVariants = ['classTeacher', 'departmentHead', 'classPrefect', 'schoolPrefect'] as const;

  it('defines a distinct, muted style for every badged role', () => {
    for (const key of roleVariants) {
      expect(BADGE_VARIANTS).toHaveProperty(key);
    }
  });

  it('gives each role a visually distinct color (no two share the same className)', () => {
    const classNames = roleVariants.map((k) => BADGE_VARIANTS[k]);
    expect(new Set(classNames).size).toBe(classNames.length);
  });

  it('never uses alarming/bright red for a role badge (reserved for destructive)', () => {
    for (const key of roleVariants) {
      expect(BADGE_VARIANTS[key]).not.toMatch(/red-|rose-/);
    }
  });
});
