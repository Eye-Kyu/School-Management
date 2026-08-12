-- ============================================================
-- Register 4 AI sub-modules; move document_library dependency
-- from ai_features to ai_tutor
-- ============================================================
-- ai_features stays registered as the category master switch (Option A,
-- docs/audits/ai-entitlement-splitting-plan.md §2) — parent-off-implies-
-- child-off is now delivered by 20260728000088's recursive
-- module_enabled(), not by any change in this migration.
--
-- document_library moves off ai_features and onto ai_tutor specifically:
-- of the 5 AI routes, only /ai/tutor and /ai/process-document touch
-- document_chunks (confirmed by reading apps/api/src/ai/ai.controller.ts in
-- full during the audit) — quiz generation, plagiarism detection, and
-- report comments never do. Safe to move: dependency checking is
-- write-time-only (the school_modules_check trigger), so this doesn't
-- retroactively affect any already-enabled school; it only changes what a
-- future enable-attempt validates. Confirmed via Refinement 1's read-only
-- production check (run before writing this migration) that zero schools
-- currently have ai_features enabled at all, so there is nothing to
-- retroactively affect regardless.
-- ============================================================

INSERT INTO public.modules (key, name, description, category, is_core, can_disable, status, dependencies) VALUES
  ('ai_tutor', 'AI Tutor', 'Student-facing homework help chat powered by document knowledge base', 'AI', false, true, 'ACTIVE', ARRAY['ai_features', 'document_library']),
  ('ai_quiz_generation', 'AI Quiz Generation', 'Generate quiz questions from subject content', 'AI', false, true, 'ACTIVE', ARRAY['ai_features']),
  ('ai_plagiarism_detection', 'AI Plagiarism Detection', 'Check homework and quiz answers for originality', 'AI', false, true, 'ACTIVE', ARRAY['ai_features']),
  ('ai_report_comments', 'AI Report Card Comments', 'Generate parent-friendly comment text for report cards', 'AI', false, true, 'ACTIVE', ARRAY['ai_features'])
ON CONFLICT (key) DO NOTHING;

UPDATE public.modules SET dependencies = '{}' WHERE key = 'ai_features';

INSERT INTO public._migration_log (filename) VALUES ('20260728000089_register_ai_sub_modules.sql') ON CONFLICT (filename) DO NOTHING;
