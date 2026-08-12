-- ============================================================
-- Backfill AI sub-module defaults for existing ai_features schools
-- ============================================================
-- Refinement 1's production check (run before any migration code in this
-- PR) confirmed zero schools currently have ai_features enabled at all —
-- this migration is a guaranteed no-op today, verified by row-count after
-- applying. It still lands as its own migration for whenever real schools
-- exist with ai_features enabled in the future.
--
-- Explicit `enabled = false` rows for the other three, not silent absence:
-- module_enabled()'s "no active subscription -> true" default rule would
-- otherwise silently default any school without an active subscription to
-- enabled for the other three sub-modules, contradicting "admins opt into
-- the other three explicitly." Writing explicit false rows makes the
-- outcome deterministic regardless of a school's subscription state.
--
-- Idempotent via ON CONFLICT (school_id, module_key) DO NOTHING — safe to
-- rerun. Schools that never had ai_features enabled get no rows from this
-- migration at all, either way.
-- ============================================================

INSERT INTO public.school_modules (school_id, module_key, enabled, enabled_at, config)
SELECT school_id, 'ai_report_comments', true, now(), '{}'
FROM public.school_modules
WHERE module_key = 'ai_features' AND enabled = true
ON CONFLICT (school_id, module_key) DO NOTHING;

INSERT INTO public.school_modules (school_id, module_key, enabled, config)
SELECT school_id, key_to_seed, false, '{}'
FROM public.school_modules,
     unnest(ARRAY['ai_tutor', 'ai_quiz_generation', 'ai_plagiarism_detection']) AS key_to_seed
WHERE module_key = 'ai_features' AND enabled = true
ON CONFLICT (school_id, module_key) DO NOTHING;

INSERT INTO public._migration_log (filename) VALUES ('20260728000090_backfill_ai_sub_modules.sql') ON CONFLICT (filename) DO NOTHING;

-- ============================================================
-- Down migration (manual — this repo has no automated migration-rollback
-- runner; every other migration here is forward-only too). Run by hand
-- against DIRECT_URL if this PR is ever reverted:
--
--   DELETE FROM public.school_modules
--   WHERE module_key IN ('ai_tutor', 'ai_quiz_generation', 'ai_plagiarism_detection', 'ai_report_comments');
--
--   DELETE FROM public.modules
--   WHERE key IN ('ai_tutor', 'ai_quiz_generation', 'ai_plagiarism_detection', 'ai_report_comments');
--
--   UPDATE public.modules SET dependencies = ARRAY['document_library'] WHERE key = 'ai_features';
--
-- Does not touch ai_features' own school_modules rows — its pre-existing
-- per-school state stands as-is; "consolidating back to the parent" means
-- discarding the sub-toggle preferences, not restoring any prior value on
-- ai_features itself (this migration never touched it).
-- ============================================================
