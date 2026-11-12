// SA-12 / SA-13 (security audit 2026-11): the assist-mode server client must
// (a) refuse tables outside the school-scoped allowlist, and (b) run a
// service-role read only after confirming the signed-in user is the token's
// super-admin and the grant is still live. Supabase, cookies and the token
// verifier are mocked. This exercises lib/supabase/server.ts's real proxy logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CLAIMS = {
  superAdminUserId: 'sa-user-id',
  targetSchoolId: 'school-A',
  accessGrantId: 'grant-1',
  grantedScopes: ['ACADEMIC_DATA'],
};

type Result = { data: unknown; error: unknown };
const state: {
  sessionAuthId: string | null;
  callerRow: Record<string, unknown> | null;
  grantRow: Record<string, unknown> | null;
  dataExecuted: string[];
  eqCalls: Array<[string, string, unknown]>;
} = { sessionAuthId: null, callerRow: null, grantRow: null, dataExecuted: [], eqCalls: [] };

function builder(table: string, result: () => Result) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'in', 'neq', 'gte', 'lte']) b[m] = () => b;
  b.eq = (col: string, val: unknown) => { state.eqCalls.push([table, col, val]); return b; };
  b.maybeSingle = () => Promise.resolve(result());
  b.single = () => Promise.resolve(result());
  b.then = (onF: (v: Result) => unknown, onR?: (e: unknown) => unknown) => {
    state.dataExecuted.push(table);
    return Promise.resolve(result()).then(onF, onR);
  };
  return b;
}

vi.mock('next/headers', () => ({ cookies: () => ({ get: (n: string) => (n === 'sm_assist' ? { value: 'assist-token' } : undefined), set: () => {} }) }));
vi.mock('@/lib/assistMode', () => ({ ASSIST_MODE_COOKIE: 'sm_assist', verifyAssistTokenSync: () => CLAIMS }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.sessionAuthId ? { id: state.sessionAuthId } : null } }) },
    from: () => { throw new Error('real client .from must not be used in assist mode'); },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'users') return builder(table, () => ({ data: state.callerRow, error: null }));
      if (table === 'privileged_access_grants') return builder(table, () => ({ data: state.grantRow, error: null }));
      return builder(table, () => ({ data: [{ id: 'row-1' }], error: null }));
    },
  }),
}));

const { createClient } = await import('../supabase/server');

const owner = { id: 'sa-user-id', role: 'SUPER_ADMIN', is_active: true, deleted_at: null };
const liveGrant = () => ({
  super_admin_user_id: 'sa-user-id', target_school_id: 'school-A', status: 'ACTIVE',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
});

beforeEach(() => {
  state.sessionAuthId = 'sa-auth-id';
  state.callerRow = owner;
  state.grantRow = liveGrant();
  state.dataExecuted = [];
  state.eqCalls = [];
});

describe('assist-scoped server client', () => {
  it('SA-13: refuses a table outside the allowlist without querying it', async () => {
    const res = (await createClient().from('guardians').select('*')) as Result;
    expect((res.error as { code: string }).code).toBe('ASSIST_DENIED');
    expect(state.dataExecuted).not.toContain('guardians');
  });

  it('runs an allowlisted read scoped to the target school for the owning super-admin', async () => {
    const res = (await createClient().from('students').select('id').order('id')) as Result;
    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ id: 'row-1' }]);
    expect(state.eqCalls).toContainEqual(['students', 'school_id', 'school-A']);
  });

  it('scopes the schools table by id', async () => {
    await createClient().from('schools').select('name');
    expect(state.eqCalls).toContainEqual(['schools', 'id', 'school-A']);
  });

  it('SA-12: denies when the signed-in user is not the token super-admin', async () => {
    state.callerRow = { id: 'someone-else', role: 'ADMIN', is_active: true, deleted_at: null };
    const res = (await createClient().from('students').select('id')) as Result;
    expect((res.error as { code: string }).code).toBe('ASSIST_DENIED');
    expect(state.dataExecuted).not.toContain('students');
  });

  it('SA-12: denies with no session (cookie outliving sign-out)', async () => {
    state.sessionAuthId = null;
    const res = (await createClient().from('students').select('id')) as Result;
    expect((res.error as { code: string }).code).toBe('ASSIST_DENIED');
  });

  it('SA-12: denies once the grant is ended or expired, before JWT exp', async () => {
    state.grantRow = { ...liveGrant(), status: 'ENDED' };
    expect(((await createClient().from('students').select('id')) as Result).error).not.toBeNull();
    state.grantRow = { ...liveGrant(), expires_at: new Date(Date.now() - 1000).toISOString() };
    expect(((await createClient().from('students').select('id')) as Result).error).not.toBeNull();
    expect(state.dataExecuted).not.toContain('students');
  });

  it('SA-12: denies a grant owned by a different super-admin', async () => {
    state.grantRow = { ...liveGrant(), super_admin_user_id: 'other-sa' };
    expect(((await createClient().from('students').select('id')) as Result).error).not.toBeNull();
  });

  it('still blocks writes through the assist client', () => {
    expect((createClient().from('students') as unknown as { insert?: unknown }).insert).toBeUndefined();
  });
});
