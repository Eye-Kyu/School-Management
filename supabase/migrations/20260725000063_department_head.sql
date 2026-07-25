-- ============================================================
-- Department Heads
-- ============================================================
-- Additive: a nullable FK column on the existing departments table. One head
-- per department (single-valued column). The two business rules — target
-- user must belong to the department, and one person can head at most one
-- department — are enforced in DepartmentsService, not as DB constraints:
-- "target user's teachers.department_id matches" isn't expressible as a
-- declarative CHECK (it requires a cross-table lookup), and this repo's own
-- prior incident (20260723000048_fix_department_soft_delete_trigger.sql)
-- already showed that a trigger doing a nested cross-table write/read here
-- can make Postgres reject the outer UPDATE under RLS — so this follows the
-- same "explicit service-layer check" pattern that incident settled on.
-- ============================================================

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS department_head_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
