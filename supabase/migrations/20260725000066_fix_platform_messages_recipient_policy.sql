-- ============================================================
-- Fix pm_select_recipient — it never actually matched any row
-- ============================================================
-- Root cause: the EXISTS subquery referenced a bare `id`, intending to
-- correlate to the outer platform_messages.id being filtered by this
-- policy. But platform_message_recipients (the subquery's own FROM table,
-- aliased `r`) also has its own `id` column (its primary key) — per normal
-- SQL scoping, an unqualified column reference inside a subquery resolves
-- against the subquery's own FROM-clause tables first, before falling back
-- to an outer/correlated reference. So `id` silently resolved to `r.id`
-- (the recipient row's own PK), turning the condition into
-- `r.platform_message_id = r.id` — comparing an FK to an unrelated PK on
-- the same row, which is essentially never true. The policy has therefore
-- never actually granted a School Admin SELECT access to any
-- platform_messages row since this table was introduced
-- (20260723000053_platform_messages.sql) — confirmed live: a real School
-- Admin's RLS-scoped read of their own broadcast message came back empty,
-- with current_user_id() independently confirmed correct for that session.
--
-- This is the actual root cause of "SuperAdmin broadcast never appears on
-- the School Admin dashboard/notifications" — not a missing dashboard
-- widget alone (that gap is real too, fixed separately in the frontend, but
-- without this fix the read would still come back empty either way).
--
-- Fix: qualify the outer-table reference explicitly, matching this
-- codebase's established idiom elsewhere (e.g.
-- 20260725000065_absence_requests.sql's absence_requests_select, which
-- correctly writes `s.id = absence_requests.student_id`, not a bare `id`).
-- ============================================================

ALTER POLICY "pm_select_recipient" ON public.platform_messages
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_message_recipients r
      WHERE r.platform_message_id = platform_messages.id AND r.recipient_user_id = current_user_id()
    )
  );
