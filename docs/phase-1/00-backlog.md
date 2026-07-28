# Phase 1 Backlog — Ordered by External Dependency Unblock

Phase 0 closed 2026-07-29 (see [`docs/phase-0/00-master-plan.md`](../phase-0/00-master-plan.md)) with two sub-sprints relocated here rather than left open-ended in a "closed" phase: both were blocked on external, owner-initiated actions that never resolved during Phase 0's window. Three new items are added here for the first time — deferred from Phase 0's own explicit "does NOT include" list, not previously planned in any sub-sprint doc.

None of these five items has started. This is a backlog, not a schedule — items activate in whatever order their blockers clear, not necessarily the order listed.

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

When an item's trigger fires, that sub-sprint activates as the next Phase 1 work. Trigger firing is an owner-initiated event, not automatic.
