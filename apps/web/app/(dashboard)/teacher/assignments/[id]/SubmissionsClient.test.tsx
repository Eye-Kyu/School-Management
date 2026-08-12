// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SubmissionsClient from './SubmissionsClient';

const isModuleEnabledMock = vi.fn();
vi.mock('@/lib/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isModuleEnabled: isModuleEnabledMock }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}));
vi.mock('@/lib/supabase/currentUser', () => ({
  getCurrentUserRow: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

const student = { id: 'student-1', user: { full_name: 'Ada Wanjiru' } };
const submission = {
  id: 'sub-1', student_id: 'student-1', content: 'My essay answer.', file_urls: [],
  submitted_at: '2026-08-01T00:00:00Z', is_late: false, grade_score: null, grade_comment: null,
};

describe('SubmissionsClient — AI plagiarism detection gating', () => {
  beforeEach(() => {
    isModuleEnabledMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the "Check with AI" affordance when ai_plagiarism_detection is enabled', () => {
    isModuleEnabledMock.mockImplementation((key: string) => key === 'ai_plagiarism_detection');
    render(<SubmissionsClient assignmentId="a1" maxScore={100} students={[student]} submissions={[submission]} />);
    expect(screen.getByText('🔍 Check with AI')).toBeInTheDocument();
  });

  it('hides the AI plagiarism affordance entirely when disabled', () => {
    isModuleEnabledMock.mockReturnValue(false);
    render(<SubmissionsClient assignmentId="a1" maxScore={100} students={[student]} submissions={[submission]} />);
    expect(screen.queryByText('🔍 Check with AI')).not.toBeInTheDocument();
  });
});
