// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CommentForm from './CommentForm';

const isModuleEnabledMock = vi.fn();
vi.mock('@/lib/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isModuleEnabled: isModuleEnabledMock }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./AiCommentButton', () => ({
  default: () => <div data-testid="ai-comment-button" />,
}));

describe('CommentForm — AI report comment gating', () => {
  beforeEach(() => {
    isModuleEnabledMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the AI draft button when ai_report_comments is enabled and the form is not read-only', () => {
    isModuleEnabledMock.mockImplementation((key: string) => key === 'ai_report_comments');
    render(<CommentForm studentId="s1" termId="t1" existing={null} locked={false} canSign={false} isAdmin={false} />);
    expect(screen.getByTestId('ai-comment-button')).toBeInTheDocument();
  });

  it('hides the AI draft button entirely when ai_report_comments is disabled', () => {
    isModuleEnabledMock.mockReturnValue(false);
    render(<CommentForm studentId="s1" termId="t1" existing={null} locked={false} canSign={false} isAdmin={false} />);
    expect(screen.queryByTestId('ai-comment-button')).not.toBeInTheDocument();
  });

  it('stays hidden when locked, even if ai_report_comments is enabled (existing readOnly rule unchanged)', () => {
    isModuleEnabledMock.mockReturnValue(true);
    render(<CommentForm studentId="s1" termId="t1" existing={null} locked={true} canSign={false} isAdmin={false} />);
    expect(screen.queryByTestId('ai-comment-button')).not.toBeInTheDocument();
  });
});
