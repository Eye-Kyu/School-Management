// =============================================================================
// Server-side Supabase client (App Router server components)
// =============================================================================
// Use this from SERVER components and route handlers. It reads/writes the
// session cookie via next/headers. RLS is enforced as the authenticated user.
//
// Assist mode: if a valid sm_assist cookie is present, createClient() returns
// a client whose .from() calls run against a service-role client scoped to
// the target school, while .auth stays wired to the caller's REAL session
// (see buildAssistScopedClient) — every dashboard server component reads
// through this one chokepoint, so this gives broad, low-footprint coverage of
// /admin/* for a SuperAdmin browsing a school in assist mode.
//
// KNOWN LIMITATION: pages that look up "my own users row" (auth_id = me) to
// resolve their own identity/permissions get an empty result while in assist
// mode — the SuperAdmin's real users row has school_id = NULL, and every
// .select() here is filtered to the target school. Pages built around "I am
// a member of this school" (most of this app's dashboard pages) will render
// their empty/blank state rather than real content for those specific
// lookups. Full coverage would mean auditing every /admin/* page individually
// — out of scope for this PR; flagged here and in EXECUTION_PLAN.md as a
// follow-up.
// =============================================================================

import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { ASSIST_MODE_COOKIE, verifyAssistTokenSync } from '@/lib/assistMode';

// Tables with a direct school_id column — school-scoped automatically on
// every .select() while in assist mode. A table NOT in this list (e.g.
// teachers, which is scoped via user_id -> users.school_id instead) is
// returned unfiltered when read through the assist-scoped client — a known,
// documented limitation for this PR, not a silent gap: add it here once a
// real assist-mode page needs to read that table directly.
const DIRECT_SCHOOL_ID_TABLES = new Set([
  'users', 'students', 'classes', 'attendance_records', 'fee_balances', 'announcements',
  'assignments', 'submissions', 'quizzes', 'quiz_attempts', 'quiz_questions', 'documents',
  'behaviour_points', 'permission_slips', 'notifications', 'conversations', 'messages',
  'subjects', 'terms', 'departments', 'homework_assignments', 'homework_completions',
  'events', 'student_report_cards', 'timetable_slots', 'grades', 'assessments',
]);

/**
 * ASSIST MODE: RLS bypassed intentionally, school_id filter enforced at app
 * layer. current_school_id() can't know about assist context (the caller's
 * REAL school_id stays NULL — see the migration comment in
 * 20260722000034_privileged_access.sql) so there is no RLS-only way to scope
 * these reads; a service-role client + explicit .eq('school_id', ...) on
 * every query is the only option. Code-review checklist: any new
 * supabase.admin-equivalent call site must carry this exact comment.
 *
 * .auth is left wired to `realClient` (the caller's own RLS-scoped session)
 * so identity checks (`supabase.auth.getUser()`, present at the top of
 * nearly every dashboard page) keep resolving the real SuperAdmin, not a
 * sessionless service-role client. Only .from() is redirected.
 *
 * Only intercepts .select() — write methods (insert/update/upsert/delete)
 * are deliberately NOT forwarded to the service-role client. Every
 * dashboard server component in this app only ever reads via createClient();
 * mutations happen in separate 'use client' components using
 * lib/supabase/client.ts, which this file has no effect on. If some future
 * server component tries to write through this client while in assist mode,
 * it fails loudly (TypeError: not a function) rather than silently bypassing
 * RLS for a write.
 */
function buildAssistScopedClient(realClient: SupabaseClient, targetSchoolId: string): SupabaseClient {
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  return new Proxy(realClient, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => {
          const qb = (admin as any).from(table);
          if (!DIRECT_SCHOOL_ID_TABLES.has(table)) return qb;

          return new Proxy(qb, {
            get(qbTarget, qbProp, qbReceiver) {
              if (qbProp === 'select') {
                const orig = Reflect.get(qbTarget, qbProp, qbReceiver);
                return (...args: unknown[]) => {
                  const filterBuilder = (orig as (...a: unknown[]) => any).apply(qbTarget, args);
                  return filterBuilder.eq('school_id', targetSchoolId);
                };
              }
              if (['insert', 'update', 'upsert', 'delete'].includes(qbProp as string)) {
                return undefined; // fails loudly if ever called — see doc comment above
              }
              const orig = Reflect.get(qbTarget, qbProp, qbReceiver);
              return typeof orig === 'function' ? orig.bind(qbTarget) : orig;
            },
          });
        };
      }
      // .auth, .storage, .rpc, etc. all fall through to the real, RLS-scoped
      // session client — only tenant-table reads are redirected.
      const orig = Reflect.get(target, prop, receiver);
      return typeof orig === 'function' ? orig.bind(target) : orig;
    },
  }) as SupabaseClient;
}

/** Always the caller's own RLS-scoped session — never assist-swapped. Use
 * this for identity/chrome concerns (the (dashboard) layout's own
 * name/role/avatar) that must reflect the REAL caller even while they're
 * browsing a target school's data in assist mode. Page content should use
 * createClient() instead. */
export function createRealClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component where cookies are read-only.
            // The middleware refreshes the session cookie, so this is safe to ignore.
          }
        },
        remove(name: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // See note above.
          }
        },
      },
    },
  );
}

export function createClient() {
  const cookieStore = cookies();
  const realClient = createRealClient();

  const assistToken = cookieStore.get(ASSIST_MODE_COOKIE)?.value;
  if (assistToken) {
    const claims = verifyAssistTokenSync(assistToken);
    if (claims) return buildAssistScopedClient(realClient, claims.targetSchoolId);
  }

  return realClient;
}
