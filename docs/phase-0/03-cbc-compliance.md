# Phase 0, Sub-sprint 3: CBC Compliance

**Goal.** Teachers assess against Kenya's Competency-Based Curriculum structure (7 core competencies × 4 performance levels: EE/ME/AE/BE) with AI-suggested narrative comments and one-click KICD-compliant report card generation.

**Status.** Planning only. No code, migrations, or tests in this doc's own PR.

---

## 1. Current state audit

### Gradebook / assessment model — schema drift found

**Critical finding**: the committed migration and the live table disagree.

- **Migration-file schema** (`supabase/migrations/20260527000012_gradebook.sql:39-52`) describes `assessments` with `kind CHECK IN ('QUIZ','TEST','EXAM','CAT','ASSIGNMENT','OTHER'), weight, max_score, date, created_by_id`.
- **The actual live schema** — confirmed independently by a code comment in `apps/api/src/privileged-access/platform-privileged-access.service.ts:330-337` and by an e2e test block (`apps/api/test/cross-tenant.e2e-spec.ts:1729-1823`) — is `id, school_id, class_id, subject_id, term_id, teacher_id NOT NULL, name, description, max_marks, assessment_date, created_at`. **No `kind`, `weight`, `max_score`, `date`, or `created_by_id` column exists on the real table.** This matches `packages/db/prisma/schema.prisma:346-371`, which is itself not the deployed migration path either.
- `apps/api/src/assessments/assessments.service.ts:6` and `apps/web/app/(dashboard)/teacher/gradebook/GradebookClient.tsx:47-48,84-93` both already query/insert `max_marks`/`assessment_date`/`teacher_id`/`description` — current app code assumes the live schema, not the committed migration.
- **Implication**: any new CBC migration must be additive (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, the pattern already used in `20260723000044_report_card_signoff.sql` and `20260724000057_curriculum_grade_levels_strands.sql`) and verified against the live database during implementation — never assumed from `20260527000012_gradebook.sql`'s text.

**No competency/category tag exists today** — there's nothing to extend; a CBC tag would be wholly new. The natural attach point is `assessments.subject_id`/`class_id`, but subjects/classes have zero FK relationship to the platform curriculum catalog (below) — new linkage is needed, not just new semantics on an existing one.

**Score aggregation — three independent, mutually inconsistent implementations**, no shared helper or DB view:
- `apps/web/app/report-card/[studentId]/page.tsx:61-86` — sums total marks/max per subject (a ratio, not an average of per-assessment percentages).
- `apps/web/app/print/report-card/[studentId]/page.tsx:61-78` — averages per-assessment percentages (different math — the same student/term can show a different % on the two pages).
- `apps/api/src/ai/ai.controller.ts:83-96` — re-implements the per-assessment-percentage average again, independently, for AI context.

### Report card renderers — two genuinely different artifacts

- **`/report-card/[studentId]`** — full per-assessment breakdown table, letter-grade boundaries 75/60/50/40, no attendance, no comments, no sign-off. Reached only from `student/grades`.
- **`/print/report-card/[studentId]`** — subject-average-only table, **different** letter-grade boundaries 80/70/60/50, an attendance summary block, comments (`student_report_cards.class_teacher_comment`/`head_teacher_comment`), sign-off state (`locked_at`/`signed_by_id`), and a `?edit=1` mode triggering `CommentForm.tsx`. This is the one the admin workflow (`admin/report-cards/page.tsx`) links to for View/Edit — the "official" artifact.
- **These two renderers disagreeing on both math and grade boundaries is a real, pre-existing inconsistency** — not this sub-sprint's job to fix, but worth flagging (see master plan).
- Sign-off: a `BEFORE UPDATE` trigger plus `rc_update` RLS blocks TEACHER writes once `locked_at` is set (ADMIN can still unlock). The comment save path is a client-side Supabase upsert — there is no NestJS endpoint for saving/signing report card comments (only the AI-draft step goes through the API).
- **Admin workflow is strictly one student at a time.** Grepped the whole repo for "bulk" — zero report-card-related matches. No bulk/per-class generation exists anywhere.

### Curriculum seed data — "strands" are not competencies

Schema (`supabase/migrations/20260722000033_curriculum.sql`, `20260724000057_curriculum_grade_levels_strands.sql`): `curricula` → `curriculum_grade_levels` → `curriculum_subjects` → `curriculum_subject_strands`. The last table is a plain named list of content headings (e.g. "Numbers," "Algebra") per subject/grade — no proficiency/level semantics, no student-facing rows, no aggregation concept. The whole catalog is explicitly **informational only**: its own migration header states assigning a curriculum "never modifies" a school's actual tables — a school's real `subjects`/`assessments` have zero FK relationship to this catalog at all.

**The word "competency" appears exactly once in the entire repo** — in the CBC curriculum's display-name string (`"Competency-Based Curriculum (CBC)"`). No CBC competency (Communication & Collaboration, Critical Thinking, etc.) or EE/ME/AE/BE level is named anywhere in code or seed data. The seed data itself (`packages/db/prisma/seed-data/curriculums/cbc.json`) has 46 subjects across 14 grade levels, but `strands_per_grade` is populated for **only Mathematics, only 2 of the 14 grades** — everything else is an empty object, deliberately (the seed's own verification notes say "not populated rather than guessed"). **This sub-sprint needs real content-population work from a subject-matter source, not just a schema change.**

### Existing AI report-card narrative — the reuse pattern

`POST /ai/report-card-comment` (`apps/api/src/ai/ai.controller.ts:47-123`, `ai.service.ts:120-150`), guarded by `FeatureGuard`/`@RequireModule('ai_features')`. Server assembles context — student name, per-subject averages (re-derived ad hoc, same inconsistency noted above), attendance rate, an optional freeform teacher-notes string — sends a fixed system prompt plus this context to `claude-opus-4-8` (`max_tokens: 256`, system prompt cached), returns one holistic `{comment: string}`. `AiCommentButton.tsx` → `CommentForm.tsx` pipes the draft into an editable textarea; the teacher's final edit is saved as a plain Supabase upsert into `student_report_cards.class_teacher_comment` — **no distinction is preserved between AI-drafted and hand-typed text, no audit trail**. Reusing this for CBC means parameterizing per competency (N calls, or one multi-part call) and finding a new place to store N narratives — today's table has exactly two holistic comment columns, nothing per-competency.

### Teacher gradebook UI

`GradebookClient.tsx` is a plain HTML table, one score `<input>` per student × assessment, debounced (800ms) autosave direct to Supabase (bypasses NestJS, same direct-write pattern as the report-card pages). The "+ Add assessment" form has only name/max_marks/date fields — no metadata affordance exists in the UI today at all. **Realistic CBC-tagging attach point: one competency dropdown added to the assessment-creation form** (applies to all students' scores on that assessment) — per-score-cell tagging has no existing precedent and would need real layout rework, not a small addition.

---

## 2. Gap-to-goal analysis

| Goal | Gap size | Dependencies | Risk | Testability |
|---|---|---|---|---|
| Model CBC competency structure, additive to the gradebook | **L** | Verified EE/ME/AE/BE score-boundary definitions from KICD | Wrong boundaries misrepresent a child's official competency standing — a real accuracy/credibility risk on a document parents and inspectors will read | Tag an assessment, submit scores, verify the aggregation buckets a student into the right level at exact boundary values (not just clearly-inside-a-bucket values) |
| CBC-compliant report card template | **L–XL** | Sample current-year KICD report card (blocks layout, not the data model); needs the competency goal above | Shipping a report card that looks official but doesn't match the real current KICD format could embarrass a school in front of parents/inspectors | Generate a report card for a student with mixed competency levels across subjects, verify all 7 core + relevant subject-specific competencies render, verify an untagged competency shows a clear "not yet assessed" state rather than a misleading blank |
| AI-suggested per-competency narratives, reusing the existing pattern | **M** | Needs the competency goal above, plus a storage decision (below) | Cost/latency multiplier: today's report-card AI call is one per student; naive per-competency reuse is 7–10 calls per student — worth exploring one batched/structured call instead | e2e: endpoint requires `ai_features` enabled (matches the existing `FeatureGuard` pattern); returns one narrative per requested competency; a teacher's edit persists correctly without affecting other competencies/students |
| One-click bulk generation per class | **L** | Needs both goals above | Partial-failure handling must be explicit — if student 22 of 40 fails (e.g. an AI API hiccup), a silent partial failure would look like full success to the admin otherwise | Bulk-generate for a class of N, verify N rows created/updated, inject a deliberate single-student failure, verify it doesn't corrupt or block the other N-1 and the admin sees an accurate success/failure count |

---

## 3. Implementation plan

**The storage decision** (affects both the report-card and narrative goals): a new `student_competency_narratives(student_id, term_id, competency_code, narrative, ...)` table, additive, with RLS/trigger shape copied from the existing `student_report_cards` (reuse the sign-off pattern established there, don't reinvent it). `student_report_cards` itself has exactly two holistic comment columns and should not be repurposed for per-competency data.

**Migrations** (one per logical change):
1. New platform-level `cbc_competencies` catalog — same shape as `curricula` (SUPER_ADMIN-seeded, universal `SELECT` RLS): `id, code, name, description, applies_to_subject (nullable — null for the 7 core competencies, set for subject-specific ones), display_order`.
2. `ALTER TABLE assessments ADD COLUMN IF NOT EXISTS competency_code TEXT REFERENCES cbc_competencies(code)` — nullable, additive. **Verify the live schema directly before writing this migration**, per the schema-drift finding above.
3. New `student_competency_narratives` table, RLS mirroring `student_report_cards`'s existing shape exactly.

**Tasks** (as they'd appear in the implementation prompt):
- Seed `cbc_competencies` with the 7 core competencies plus subject-specific ones (content sourced/verified externally — see dependencies).
- Add a competency dropdown to `GradebookClient.tsx`'s "+ Add assessment" form.
- Write **one** new, clearly-named aggregation function for competency-level rollup (score % → EE/ME/AE/BE) for CBC's own use. Do not touch or consolidate the three existing inconsistent aggregation implementations — that's a separate, adjacent fix, out of this sub-sprint's scope (flagged in the master plan instead).
- New report card route/template (e.g. `apps/web/app/print/report-card-cbc/[studentId]/page.tsx`) rendering the per-competency EE/ME/AE/BE grid — added alongside the two existing renderers, not replacing either, per the task's own anti-scope instruction.
- New `generateCompetencyNarrative` method in `ai.service.ts`, parameterized by competency + aggregated level + relevant scores, following the exact prompt-construction pattern already used by `generateReportCardComment`.
- Bulk generation endpoint: iterate every student in a class+term, run aggregation + narrative generation per student, create/update their competency narrative rows. Given the per-student cost (multiple AI calls), run this as a background job matching the existing `NotificationsScheduler` cron pattern, or a "kick off and poll for completion" UX — not a single blocking HTTP request that risks timing out on a 30-40-student class.

**Audit logs**: `report_card.cbc_bulk_generate` (class_id, term_id, student_count, success_count, failure_count) — a class-wide mutation worth logging.

**Cross-tenant test coverage plan**:
- A competency tag/aggregate never crosses schools.
- Bulk generation for one class never touches another school's students, even with a crafted class id.
- Boundary-value tests for the EE/ME/AE/BE cutoffs specifically, not just clearly-inside-a-bucket values.

**Explicit anti-scope** (restated from the task spec):
- No gradebook rewrite — the competency layer is additive only.
- No replacing the existing report card renderer(s) — a CBC template sits alongside them.
- No automatically populating competency tags from historical data — teachers tag going forward only.
- No 8-4-4 or Cambridge report cards in this sub-sprint — CBC only.
- No per-student learning-outcome tracking below competency level.

---

## 4. External dependencies

| Dependency | Blocks implementation? | Notes |
|---|---|---|
| Verified current KICD report card format | **YES** (for the template goal) | Data-model work (goal 1) can proceed without it |
| Verified CBC competency list per grade level and subject, cross-checked against the curriculum seed data | **YES** | The seed data audit found essentially nothing usable here — this needs real content sourcing/verification from a subject-matter source, not just a technical decision |
| Sample KICD-compliant report cards from a pilot school | **YES** | Blocks template design specifically |
| **Human decision**: EE/ME/AE/BE score-boundary mapping | **YES** | Must come from KICD assessment guidelines — not invented |
| Technical decision (non-blocking): N-separate-AI-calls vs. one batched/structured call per student | No | Real budget implications either way; the implementation PR should decide, flagged here so it isn't missed |
