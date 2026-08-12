// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModuleAccess } from './useModuleAccess';

const apiFetchMock = vi.fn();
vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe('useModuleAccess', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('fails open while loading — isModuleEnabled returns true for any key before /auth/me resolves', () => {
    apiFetchMock.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { result } = renderHook(() => useModuleAccess());
    expect(result.current.loading).toBe(true);
    expect(result.current.isModuleEnabled('ai_tutor')).toBe(true);
    expect(result.current.isModuleEnabled('anything_at_all')).toBe(true);
  });

  it('reflects the populated enabledModules set once /auth/me resolves', async () => {
    apiFetchMock.mockResolvedValue({ enabledModules: ['ai_report_comments', 'homework'] });
    const { result } = renderHook(() => useModuleAccess());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isModuleEnabled('ai_report_comments')).toBe(true);
    expect(result.current.isModuleEnabled('homework')).toBe(true);
  });

  it('a key absent from enabledModules resolves to false once loaded', async () => {
    apiFetchMock.mockResolvedValue({ enabledModules: ['ai_report_comments'] });
    const { result } = renderHook(() => useModuleAccess());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isModuleEnabled('ai_tutor')).toBe(false);
    expect(result.current.isModuleEnabled('ai_quiz_generation')).toBe(false);
    expect(result.current.isModuleEnabled('ai_plagiarism_detection')).toBe(false);
  });

  it('a failed /auth/me call resolves to an empty set — every key reads false, never left permanently loading', async () => {
    apiFetchMock.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useModuleAccess());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isModuleEnabled('ai_tutor')).toBe(false);
  });
});
