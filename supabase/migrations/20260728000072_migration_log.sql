-- ============================================================
-- Phase 0, sub-sprint 4: migration parity tracking
-- ============================================================
-- This project has no migration-tracking table of any kind. `prisma migrate
-- dev` ran exactly once, at project start (packages/db/prisma/migrations/
-- has only 2 entries) — every schema change since has been a raw SQL file in
-- this directory, applied by hand via the Supabase Studio SQL editor.
-- `_prisma_migrations` and `supabase_migrations.schema_migrations` (the two
-- registries `infra/scripts/check-migrations.sh` might otherwise have
-- queried) both confirmed absent from this project. This table is the
-- registry, built from scratch rather than assumed to already exist.
--
-- The backfill below lists every migration file that existed in this
-- directory as of this PR (72 files) — verified as of 2026-07-27 that every
-- table/column from every one of them is present in the live schema (done
-- while chasing down a genuinely missing one, 20260529000019_payments.sql,
-- during sub-sprint 2's verification), so backfilling "applied_at = now()"
-- for all of them is an honest confirmed-as-of-today record, not fabricated
-- history.
--
-- Going forward: every new migration file ends with the self-registering
-- INSERT below (see the bottom of this very file for the pattern). The
-- registry only stays accurate because each file writes its own row — there
-- is no way to detect "applied" from outside.
-- ============================================================

CREATE TABLE IF NOT EXISTS public._migration_log (
  filename    TEXT        NOT NULL PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public._migration_log (filename) VALUES
  ('20260522000001_init.sql'),
  ('20260522000002_enable_rls.sql'),
  ('20260522000003_auth_user_trigger.sql'),
  ('20260526000004_announcements_author_fk.sql'),
  ('20260526000005_teacher_department.sql'),
  ('20260526000006_class_prefect.sql'),
  ('20260526000007_payment_records.sql'),
  ('20260526000008_events_homework.sql'),
  ('20260526000009_notifications.sql'),
  ('20260526000010_add_avatar_url.sql'),
  ('20260527000011_messaging.sql'),
  ('20260527000012_gradebook.sql'),
  ('20260527000013_assignments_bucket.sql'),
  ('20260527000014_quizzes.sql'),
  ('20260527000015_documents_bucket.sql'),
  ('20260527000016_report_cards.sql'),
  ('20260527000017_behaviour_safety.sql'),
  ('20260527000018_compliance_substitutes.sql'),
  ('20260527000019_notification_ack.sql'),
  ('20260529000019_payments.sql'),
  ('20260602000020_document_chunks.sql'),
  ('20260602000021_document_chunks_fts_index.sql'),
  ('20260602000022_tutor_logs.sql'),
  ('20260721000023_module_registry.sql'),
  ('20260721000024_module_enforcement_rls.sql'),
  ('20260721000025_super_admin_enum.sql'),
  ('20260721000026_super_admin_role.sql'),
  ('20260722000027_announcement_expiry.sql'),
  ('20260722000028_platform_permissions.sql'),
  ('20260722000029_school_lifecycle.sql'),
  ('20260722000030_packages.sql'),
  ('20260722000031_entitlement_engine.sql'),
  ('20260722000032_subscription_preview.sql'),
  ('20260722000033_curriculum.sql'),
  ('20260722000034_privileged_access.sql'),
  ('20260722000035_audit_log_indexes.sql'),
  ('20260722000036_platform_invoices.sql'),
  ('20260722000037_system_job_runs.sql'),
  ('20260723000038_admin_teacher_messaging.sql'),
  ('20260723000039_quiz_assignment_deadlines.sql'),
  ('20260723000040_departments.sql'),
  ('20260723000041_teacher_department_id.sql'),
  ('20260723000042_class_teacher_unique.sql'),
  ('20260723000043_class_teacher_rls.sql'),
  ('20260723000044_report_card_signoff.sql'),
  ('20260723000045_behaviour_leaderboard_columns.sql'),
  ('20260723000046_best_student_awards.sql'),
  ('20260723000047_fix_current_user_id.sql'),
  ('20260723000048_fix_department_soft_delete_trigger.sql'),
  ('20260723000049_fix_teacher_conv_insert_rls.sql'),
  ('20260723000050_fix_departments_select_for_soft_delete.sql'),
  ('20260723000051_users_update_self.sql'),
  ('20260723000052_single_attempt_lock.sql'),
  ('20260723000053_platform_messages.sql'),
  ('20260724000054_tighten_gradebook_rls.sql'),
  ('20260724000055_diag_temp.sql'),
  ('20260724000056_drop_rogue_isolation_policy.sql'),
  ('20260724000057_curriculum_grade_levels_strands.sql'),
  ('20260724000058_fix_curricula_code_unique.sql'),
  ('20260725000059_class_prefects.sql'),
  ('20260725000060_school_prefects.sql'),
  ('20260725000061_prefect_powers.sql'),
  ('20260725000062_behavior_incident_reports.sql'),
  ('20260725000063_department_head.sql'),
  ('20260725000064_attendance_remark_requests.sql'),
  ('20260725000065_absence_requests.sql'),
  ('20260725000066_fix_platform_messages_recipient_policy.sql'),
  ('20260726000067_notifications_sms_status.sql'),
  ('20260726000068_message_send_log.sql'),
  ('20260727000069_schools_paybill_shortcode.sql'),
  ('20260727000070_payment_paybill_transactions.sql'),
  ('20260727000071_payment_notifications_and_receipt_backfill.sql')
ON CONFLICT (filename) DO NOTHING;

-- Self-registration — every migration file from here on ends with its own
-- version of this line.
INSERT INTO public._migration_log (filename) VALUES ('20260728000072_migration_log.sql') ON CONFLICT (filename) DO NOTHING;
