import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mocked below the real client entirely — these tests drive the actual
// exported middleware() function through its real redirect logic, just
// without a live Supabase project or browser session.
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/assistMode', () => ({
  ASSIST_MODE_COOKIE: 'sm_assist',
  verifyAssistTokenEdge: vi.fn().mockResolvedValue(null),
}));

import { middleware } from '../../middleware';

function authedAs(role: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: {}, app_metadata: {} } } });
  mockMaybeSingle.mockResolvedValue({ data: { role } });
}

describe('middleware — cross-role dashboard redirects', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockMaybeSingle.mockReset();
  });

  it.each([
    ['TEACHER', '/parent', '/teacher'],
    ['TEACHER', '/student', '/teacher'],
    ['TEACHER', '/admin', '/teacher'],
    ['STUDENT', '/teacher', '/student'],
    ['STUDENT', '/parent', '/student'],
    ['PARENT', '/teacher', '/parent'],
    ['PARENT', '/student', '/parent'],
  ])('%s hitting %s is redirected to %s', async (role, path, expectedHome) => {
    authedAs(role);
    const res = await middleware(new NextRequest(`http://localhost:3000${path}`));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain(expectedHome);
  });

  it('a role visiting their own dashboard is NOT redirected', async () => {
    authedAs('TEACHER');
    const res = await middleware(new NextRequest('http://localhost:3000/teacher'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('an unauthenticated request to a dashboard route is redirected to /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(new NextRequest('http://localhost:3000/parent'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});
