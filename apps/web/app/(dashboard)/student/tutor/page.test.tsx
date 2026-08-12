// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AiTutorPage from './page';

const isModuleEnabledMock = vi.fn();
let modulesLoading = false;
vi.mock('@/lib/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isModuleEnabled: isModuleEnabledMock, loading: modulesLoading }),
}));
vi.mock('@/lib/api', () => ({
  API_BASE: 'http://localhost:4000',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

describe('AiTutorPage — closes the direct-navigation bypass', () => {
  beforeEach(() => {
    isModuleEnabledMock.mockReset();
    modulesLoading = false;
    // jsdom doesn't implement scrollIntoView — the page's own auto-scroll
    // effect (unrelated to this PR) calls it on every message-list render.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the chat UI when ai_tutor is enabled', () => {
    isModuleEnabledMock.mockImplementation((key: string) => key === 'ai_tutor');
    render(<AiTutorPage />);
    expect(screen.getByPlaceholderText(/./)).toBeInTheDocument(); // the chat input renders
  });

  it('renders the chat UI while modules are still loading (fail-open, no flash-then-block)', () => {
    modulesLoading = true;
    isModuleEnabledMock.mockReturnValue(false);
    render(<AiTutorPage />);
    expect(screen.queryByText(/isn.t enabled for your school/)).not.toBeInTheDocument();
  });

  it('blocks the chat UI and shows a disabled message once loaded with ai_tutor disabled — the direct-nav bypass this PR closes', () => {
    modulesLoading = false;
    isModuleEnabledMock.mockReturnValue(false);
    render(<AiTutorPage />);
    expect(screen.getByText(/isn.t enabled for your school/)).toBeInTheDocument();
  });
});
