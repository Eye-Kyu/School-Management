// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardFeed } from './DashboardFeed';
import { useDashboardFeedUnreadCount } from '@/lib/hooks/useDashboardFeed';
import type { DashboardFeedResponse } from '@/lib/dashboardFeed/types';

const apiFetchMock = vi.fn();
vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

function adminFixture(): DashboardFeedResponse {
  return {
    alerts: [
      { id: 'n1', kind: 'notification', title: 'School closed Friday', body: 'Public holiday', timestamp: '2026-07-29T10:00:00Z', isRead: false, href: '/admin', notifType: 'NEW_ANNOUNCEMENT', acknowledgedAt: null },
      { id: 'n2', kind: 'notification', title: 'Old alert', body: 'Already seen', timestamp: '2026-07-20T10:00:00Z', isRead: true, href: '/admin', notifType: 'NEW_ANNOUNCEMENT', acknowledgedAt: null },
    ],
    conversations: [
      { id: 'c1', otherPartyName: 'Jane Parent', preview: 'Can we discuss...', timestamp: '2026-07-29T09:00:00Z', unreadCount: 2, href: '/admin/messages/c1' },
    ],
    reminders: [
      { id: 'slip-gap:s1', title: 'Field trip consent', subtitle: '5 students haven\'t responded', dueDate: '2026-08-01', href: '/admin/permission-slips' },
    ],
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  apiFetchMock.mockReset();
  window.localStorage.clear();
});

// No global setupFiles is configured for this project (jsdom is deliberately
// scoped per-file via the pragma above, not globally) — without this,
// @testing-library/react doesn't auto-unmount between tests and each new
// render() just keeps piling onto the same document body.
afterEach(() => {
  cleanup();
});

describe('DashboardFeed', () => {
  it('renders alerts, conversations, and reminders for a role', async () => {
    apiFetchMock.mockResolvedValue(adminFixture());
    renderWithClient(<DashboardFeed userId="admin-1" role="ADMIN" />);

    expect(await screen.findByText('School closed Friday')).toBeInTheDocument();
    expect(screen.getByText('Jane Parent')).toBeInTheDocument();
    expect(screen.getByText('Field trip consent')).toBeInTheDocument();
  });

  it('shows the empty state when there are zero items', async () => {
    apiFetchMock.mockResolvedValue({ alerts: [], conversations: [], reminders: [] });
    renderWithClient(<DashboardFeed userId="admin-1" role="ADMIN" />);

    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it('the "Reminders" chip filters out alerts and conversations', async () => {
    apiFetchMock.mockResolvedValue(adminFixture());
    renderWithClient(<DashboardFeed userId="admin-1" role="ADMIN" />);

    await screen.findByText('School closed Friday');
    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));

    expect(screen.getByText('Field trip consent')).toBeInTheDocument();
    expect(screen.queryByText('School closed Friday')).not.toBeInTheDocument();
    expect(screen.queryByText('Jane Parent')).not.toBeInTheDocument();
  });

  it('shows the empty state when a filter matches zero items', async () => {
    apiFetchMock.mockResolvedValue({ ...adminFixture(), conversations: [] });
    renderWithClient(<DashboardFeed userId="admin-1" role="ADMIN" />);

    await screen.findByText('School closed Friday');
    fireEvent.click(screen.getByRole('button', { name: 'Conversations' }));

    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it('marking an alert read updates the notification bell sharing the same query cache', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/dashboard-feed') return Promise.resolve(adminFixture());
      if (path === '/dashboard-feed/unread-count') return Promise.resolve({ count: 1 }); // 1 unread alert (n1) — conversations/reminders excluded from bell count in this fixture-driven mock
      if (path === '/dashboard-feed/read') return Promise.resolve({ ok: true });
      return Promise.resolve({});
    });

    function Bell() {
      const { data } = useDashboardFeedUnreadCount();
      return <span data-testid="bell-count">{data?.count ?? '…'}</span>;
    }

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Bell />
        <DashboardFeed userId="admin-1" role="ADMIN" />
      </QueryClientProvider>,
    );

    await screen.findByText('School closed Friday');
    expect(screen.getByTestId('bell-count')).toHaveTextContent('1');

    // After marking read, the next /dashboard-feed/unread-count call reflects 0.
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/dashboard-feed') return Promise.resolve({ ...adminFixture(), alerts: adminFixture().alerts.map((a) => ({ ...a, isRead: true })) });
      if (path === '/dashboard-feed/unread-count') return Promise.resolve({ count: 0 });
      if (path === '/dashboard-feed/read') return Promise.resolve({ ok: true });
      return Promise.resolve({});
    });

    fireEvent.click(screen.getByRole('button', { name: /mark "school closed friday" as read/i }));

    await waitFor(() => expect(screen.getByTestId('bell-count')).toHaveTextContent('0'));
  });

  it('the compact/comfortable toggle persists to localStorage', async () => {
    apiFetchMock.mockResolvedValue(adminFixture());
    renderWithClient(<DashboardFeed userId="admin-1" role="ADMIN" />);

    await screen.findByText('School closed Friday');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to compact view' }));

    const raw = window.localStorage.getItem('dashboard-feed-prefs:admin-1:ADMIN');
    expect(raw && JSON.parse(raw).density).toBe('compact');
  });
});
