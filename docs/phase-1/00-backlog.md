# Phase 1 Backlog — Ordered by External Dependency Unblock

Phase 0 closed 2026-07-29 (see [`docs/phase-0/00-master-plan.md`](../phase-0/00-master-plan.md)) with two sub-sprints relocated here rather than left open-ended in a "closed" phase: both were blocked on external, owner-initiated actions that never resolved during Phase 0's window. Three new items are added here for the first time — deferred from Phase 0's own explicit "does NOT include" list, not previously planned in any sub-sprint doc.

None of these five items has started. This is a backlog, not a schedule — items activate in whatever order their blockers clear, not necessarily the order listed.

Items 6-7 below are a different kind of entry: deliberately deferred scope from Bucket 1, PR 2a, not externally blocked — they get a **Trigger** line instead of **External blockers**, since nothing outside this project needs to happen first, only a product signal.

---

## 1. WhatsApp (via Meta Business API)

**What:** The WhatsApp half of Phase 0 sub-sprint 1 — deliver the same notification types (attendance, fee-due, etc.) over WhatsApp as SMS already does, for parents who prefer it.

**External blockers:** Meta WhatsApp Business API application approval. Not yet submitted as of Phase 0's close — submitting it is the first Phase 1 action for this item, with a typical 2–4 week lead time after submission.

**Planning docs:** [`docs/phase-0/01-communications-reach.md`](../phase-0/01-communications-reach.md) — the WhatsApp sections there are still valid planning input; nothing about the approach needs re-deriving once the account unblocks.

---

## 2. CBC compliance (competency gradebook + AI narratives)

**What:** Phase 0 sub-sprint 3 in full — a competency-tagged assessment layer (EE/ME/AE/BE aggregation) and CBC report card generation with AI-drafted, teacher-editable per-competency narratives.

**External blockers:** KICD competency-list and sample-report-card verification, requested from the project owner in Phase 0 week 1 but not returned during the sprint window.

**Planning docs:** [`docs/phase-0/03-cbc-compliance.md`](../phase-0/03-cbc-compliance.md) — still valid planning input; the report-card grading standardization done in Phase 0 sub-sprint 4 (`packages/types/src/grading.ts`, unweighted mean-of-percentages, 80/70/60/50) is a dependency this work should build on, not duplicate.

---

## 3. Biometric attendance (ZKTeco F18)

**What:** Fingerprint-based attendance capture via ZKTeco F18 hardware, replacing or supplementing manual teacher-marked attendance.

**External blockers:** None — new planning cycle required. No planning doc exists yet; scope, hardware procurement, and integration approach (local agent vs. direct device API) all need a first pass before estimation is possible.

**Planning docs:** None — new planning cycle required.

---

## 4. Offline-first PWA

**What:** Make core teacher/admin workflows (attendance, gradebook entry) usable without a live connection, syncing once connectivity returns — addresses a real, named gap for rural pilot schools with unreliable connectivity.

**External blockers:** None — new planning cycle required. No planning doc exists yet; needs its own audit of which flows are worth the added complexity of offline conflict resolution before scoping.

**Planning docs:** None — new planning cycle required.

---

## 5. Swahili (or other local-language) UI

**What:** Localized UI for Swahili-speaking staff/parents, and infrastructure for further local-language support beyond that.

**External blockers:** None — new planning cycle required. No planning doc exists yet; needs a translation-ownership decision (who writes and maintains translated strings) before implementation scoping.

**Planning docs:** None — new planning cycle required.

---

## 6. Full quiz backend migration

**What:** Move quiz creation, question storage, attempt tracking, and grading logic from client-side Supabase to NestJS — quizzes currently have no NestJS backend at all (confirmed in `docs/audits/homework-quiz-gradebook-relationship.md`), including MCQ auto-grading, which runs unverified in the student's own browser.

**Trigger:** post-B1-2b evaluation of pilot school feedback on quiz reliability, or the introduction of any anti-cheating feature that requires server-side validation (client-side auto-grading has no server-side re-check today).

**Planning docs:** None yet — `docs/audits/homework-quiz-gradebook-relationship.md` has the current-state findings this work would build on.

---

## 7. Rich homework grading UI

**What:** Inline comments on submission content, a late-mark badge, a resubmit flow, submission-content annotation. Homework grading shipped in B1-2a as deliberately simple (score + one grader note, no content viewer — homework here is physical/in-person with nothing to view; see the B1-2a PR description).

**Trigger:** pilot school feedback that simple grading is insufficient, or a specific school requesting the feature.

**Planning docs:** None yet.

---

## 8. CLASS/SUBJECT document surfaces (subject and class detail pages)

**What:** B1-3's schema and RLS support all four document scope types (`SCHOOL_WIDE`, `CLASS`, `SUBJECT`, `ASSIGNMENT`) — `user_can_see_document()` correctly resolves visibility for all of them today. Only `SCHOOL_WIDE` and `ASSIGNMENT` shipped a UI surface in B1-3, because neither a subject detail page nor a class detail page exists for any role yet (confirmed in the Phase 1 audit, `docs/audits/documents-current-state.md` §1.4/§1.6 — only admin has flat CRUD list pages for classes/subjects, no per-item `[id]` route anywhere). A teacher can already upload a `CLASS`- or `SUBJECT`-scoped document today (correctly validated, correctly RLS-scoped) — it's just only visible afterward via admin's own filtered documents view, not on any page a student/parent/teacher would naturally look at it from.

**Trigger:** the subject/class detail pages themselves get built (for any reason — this isn't documents-specific scope), at which point adding a "Documents" section to each is a small, contained addition on top of already-shipped schema/RLS/backend.

**Planning docs:** `docs/audits/documents-current-state.md` has the full current-state findings; B1-3's Phase 2 plan has the exact `user_can_see_document()` SQL these pages would query against, unchanged.

---

## 9. Scheduled cleanup job for orphaned Storage objects

**What:** B1-3's soft delete (`documents.deleted_at`) never removes the underlying Storage object — file bytes persist indefinitely after a document is "deleted." A scheduled job (e.g. a nightly cron) to purge Storage objects for documents soft-deleted more than N days ago (30, per the original task spec) was explicitly out of scope for B1-3.

**Trigger:** storage cost becomes material, or a data-retention/compliance requirement is introduced.

**Planning docs:** None yet — would need to decide the retention window (the task's original suggestion was 30 days) and confirm no legal/compliance hold requirement exists first.

---

## 10. Full-text search on document contents

**What:** B1-3's search (Task 5/11) is a plain client-side/`ILIKE` title substring filter — no indexing of document body text for the user-facing documents library. (Note: `document_chunks` + its GIN full-text index already exist, but that infrastructure is for the AI tutor's RAG retrieval, not a user-facing "search inside my documents" feature — reusing it for search would need its own design pass, not a trivial extension.)

**Trigger:** pilot school feedback that title-only search isn't sufficient to find documents in a growing library.

**Planning docs:** None yet — `document_chunks`' existing FTS index (`supabase/migrations/20260602000021_document_chunks_fts_index.sql`) is a relevant technical precedent to evaluate reusing, not a decision already made.

---

When an item's trigger fires, that sub-sprint activates as the next Phase 1 work. Trigger firing is an owner-initiated event, not automatic.
