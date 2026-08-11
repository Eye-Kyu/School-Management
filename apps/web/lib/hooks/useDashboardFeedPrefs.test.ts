// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDashboardFeedPrefs } from './useDashboardFeedPrefs';

describe('useDashboardFeedPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to filter=all, density=comfortable when nothing is stored', () => {
    const { result } = renderHook(() => useDashboardFeedPrefs('user-1', 'ADMIN'));
    expect(result.current.filter).toBe('all');
    expect(result.current.density).toBe('comfortable');
  });

  it('persists a filter change to localStorage under a user+role-scoped key', () => {
    const { result } = renderHook(() => useDashboardFeedPrefs('user-1', 'ADMIN'));
    act(() => result.current.setFilter('reminders'));
    expect(result.current.filter).toBe('reminders');
    const raw = window.localStorage.getItem('dashboard-feed-prefs:user-1:ADMIN');
    expect(raw && JSON.parse(raw).filter).toBe('reminders');
  });

  it('persists a density change independently of filter', () => {
    const { result } = renderHook(() => useDashboardFeedPrefs('user-1', 'ADMIN'));
    act(() => result.current.setDensity('compact'));
    expect(result.current.density).toBe('compact');
    expect(result.current.filter).toBe('all'); // unaffected
  });

  it('a later render for the same user+role reads back the persisted prefs', () => {
    const { result: first } = renderHook(() => useDashboardFeedPrefs('user-1', 'ADMIN'));
    act(() => {
      first.current.setFilter('alerts');
      first.current.setDensity('compact');
    });

    const { result: second } = renderHook(() => useDashboardFeedPrefs('user-1', 'ADMIN'));
    expect(second.current.filter).toBe('alerts');
    expect(second.current.density).toBe('compact');
  });

  it('does not collide across different users on the same browser', () => {
    const { result: userA } = renderHook(() => useDashboardFeedPrefs('user-a', 'ADMIN'));
    act(() => userA.current.setFilter('conversations'));

    const { result: userB } = renderHook(() => useDashboardFeedPrefs('user-b', 'ADMIN'));
    expect(userB.current.filter).toBe('all'); // user B's own default, unaffected by user A's pref
  });

  it('falls back to defaults on malformed stored JSON rather than throwing', () => {
    window.localStorage.setItem('dashboard-feed-prefs:user-1:ADMIN', 'not valid json{');
    const { result } = renderHook(() => useDashboardFeedPrefs('user-1', 'ADMIN'));
    expect(result.current.filter).toBe('all');
    expect(result.current.density).toBe('comfortable');
  });
});
