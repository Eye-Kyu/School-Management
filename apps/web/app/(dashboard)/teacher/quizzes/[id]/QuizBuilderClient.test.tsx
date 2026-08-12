// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import QuizBuilderClient from './QuizBuilderClient';

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
vi.mock('./AiQuizGenerator', () => ({
  default: () => <div data-testid="ai-quiz-generator" />,
}));

describe('QuizBuilderClient — AI quiz generation gating', () => {
  beforeEach(() => {
    isModuleEnabledMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the AI generator when ai_quiz_generation is enabled', () => {
    isModuleEnabledMock.mockImplementation((key: string) => key === 'ai_quiz_generation');
    render(<QuizBuilderClient quiz={{ id: 'q1', is_published: false }} initialQuestions={[]} attempts={[]} />);
    expect(screen.getByTestId('ai-quiz-generator')).toBeInTheDocument();
  });

  it('hides the AI generator entirely when ai_quiz_generation is disabled', () => {
    isModuleEnabledMock.mockReturnValue(false);
    render(<QuizBuilderClient quiz={{ id: 'q1', is_published: false }} initialQuestions={[]} attempts={[]} />);
    expect(screen.queryByTestId('ai-quiz-generator')).not.toBeInTheDocument();
  });
});
