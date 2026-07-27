# Phase 0: Market-Fit Sprint — Master Plan

**Mission.** Close specific, named market-fit gaps for the Kenyan school market in a focused eight-week sprint — not a rewrite. At the end of Phase 0, the platform is genuinely competitive with JibuERP and Elimikasasa for a Kenyan school buyer. Everything here is additive to the existing system: no consolidation, no schema merges, no architectural restructure.

This document sequences the four sub-sprint planning docs. Read those first for the actual audit findings and implementation task lists:
- [`01-communications-reach.md`](./01-communications-reach.md) — SMS + WhatsApp
- [`02-mpesa-deepening.md`](./02-mpesa-deepening.md) — Paybill reconciliation + PDF receipts
- [`03-cbc-compliance.md`](./03-cbc-compliance.md) — competency gradebook layer + AI narratives
- [`04-nemis-and-hardening.md`](./04-nemis-and-hardening.md) — NEMIS export, accessibility, pentest scope, status page
- [`pentest-scope.md`](./pentest-scope.md) — the actual scope document for sub-sprint 4's pentest goal

---

## Sequencing

Sub-sprint 1's SMS half and sub-sprint 4 (NEMIS export + pentest-scope writing) have no long external blockers — natural first/parallel work. Sub-sprint 1's WhatsApp half and sub-sprint 2's Paybill reconciliation both have hard external blockers (Meta approval, 2–4 weeks; Safaricom Daraja credentials, lead time unconfirmed) that must be requested in week 1 regardless of dev order. Sub-sprint 3 (CBC) needs KICD content verification requested in week 1 too, even though it isn't a third-party account.

### Recommended order — 1 developer (Claude Code only), 8-week window

- **Week 1**: Same day — kick off the Meta WhatsApp Business API application, the Safaricom Daraja credential request, and the KICD competency-list + sample-report-card request to the project owner. All three are pure human/external actions with zero dev-time cost but the longest lead times in the whole sprint — they must not wait for "their" week to arrive. Dev starts on Africa's Talking SMS (no comparable blocker) and/or NEMIS export (also unblocked) in parallel.
- **Weeks 1–2**: SMS wiring + channel-preference UI + cost-tracking schema. NEMIS export if capacity allows.
- **Weeks 2–3**: Paybill reconciliation core — the largest single item in Phase 0 (XL). Assumes Daraja sandbox credentials have arrived by now; if not, this slips and NEMIS/accessibility work fills the gap (deliberately chosen as flex work because neither has a comparable external blocker).
- **Weeks 3–4**: PDF receipts + reconciliation dashboard. Check WhatsApp approval status.
- **Weeks 4–5**: CBC competency data model + aggregation (assumes KICD content has arrived).
- **Weeks 5–6**: CBC report card template + AI narrative reuse (assumes the sample report card has arrived).
- **Week 6**: WhatsApp wiring, *if* Meta approval has landed. This is the single piece of Phase 0 most likely to slip past week 8 purely on external timing, independent of dev effort — plan for that possibility rather than around it.
- **Week 7**: Bulk CBC generation, accessibility sweep + fixes.
- **Week 8**: Status page, full cross-tenant test pass across everything, buffer for whatever slipped, `EXECUTION_PLAN.md` update (in the first implementation PR, not this planning one).

### 2 people (Claude Code + a human developer)

Payments (sub-sprint 2) and CBC (sub-sprint 3) touch almost entirely disjoint code areas — low merge-conflict risk — and can run in true parallel tracks from week 1, compressing the timeline to roughly 5–6 weeks, with weeks 7–8 as genuine buffer/pentest-response time instead of catch-up time.

---

## Critical path items

1. **Meta WhatsApp Business API approval** — start week 1, 2–4 week lead time.
2. **Safaricom Daraja API credentials** — start week 1, lead time not independently confirmed this pass.
3. **KICD CBC competency-list + report-card-sample verification** — start week 1; this is content-gathering, not a vendor account, but has its own real lead time.
4. **Paystack production merchant account** — lower urgency than the above three; blocks only live testing, not development.

---

## Assumed team size

Both a 1-developer (Claude Code only) and a 2-person (Claude Code + one human) timeline are given above. Default planning assumption for the week-by-week calendar is 1 developer; compress by roughly 30–40% if a second contributor is confirmed.

---

## Definition of done for Phase 0

Verifiable, not lockstep across all four sub-sprints — WhatsApp in particular may genuinely finish later than week 8 if Meta hasn't approved the application yet, and this DoD says so rather than pretending every piece lands on schedule regardless of external approval timing.

- [ ] A parent with SMS enabled receives a real SMS (attendance or fee-due, at minimum) via a live Africa's Talking account, for at least one pilot school.
- [ ] WhatsApp is either delivered the same way, or explicitly deferred with a documented reason (Meta approval pending) — not silently required.
- [ ] A parent can pay via Paybill directly (not through the app) and see their child's fee balance update within a few minutes, with no admin action, for at least one real test transaction.
- [ ] Every successful payment (app-initiated or Paybill) produces a downloadable PDF receipt.
- [ ] An admin can view and manually match at least one deliberately-unmatched test payment.
- [ ] A teacher can tag an assessment with a CBC competency and see an aggregated EE/ME/AE/BE level for at least one student.
- [ ] An admin can generate CBC report cards for an entire class in one action, with AI-drafted, teacher-editable per-competency narratives.
- [ ] NEMIS export produces a file containing all currently-required fields for an admin's own school's students.
- [ ] The 15 swept pages pass axe DevTools with zero critical/serious violations, or have an explicit, owner-approved "deferred, needs redesign" note.
- [ ] `docs/phase-0/pentest-scope.md` exists and is ready to send to a candidate pentester (already true as of this planning PR).
- [ ] A public status page is live and reflects real API/DB/frontend availability.
- [ ] All new or changed backend logic has cross-tenant e2e test coverage, following this repo's established `cross-tenant.e2e-spec.ts` convention.
- [ ] `EXECUTION_PLAN.md` reflects all of the above as checked items — in the first implementation PR, not this planning one.

---

## What Phase 0 explicitly does NOT include

Deferred to later phases, per the critique that started this sprint:

biometric integration · payroll · offline-first PWA · Swahili (or other local-language) UI · boarding/hostel management · library management · transport/bus tracking · meal money/canteen accounts · **Communication Hub consolidation** (merging Announcements/Notifications/Messages/Platform Messages — explicitly rejected, not just deferred) · multi-SMS-provider architecture · WhatsApp interactive messages (buttons/lists) · cryptocurrency, bank-batch-import, or other new payment methods · SaaS-subscription auto-collection for the platform's own billing · 8-4-4/Cambridge-equivalent CBC report cards · sub-competency/learning-outcome-level tracking · real-time uptime alerting to team members (status page only) · accessibility fixes that require redesign (flagged as follow-ups instead).

---

## Gaps discovered during audit — needs owner review, NOT built into Phase 0 without approval

These surfaced while researching the four sub-sprints above but are outside their explicit goals. Listed here per instruction, not fixed:

- **`assessments` table schema drift**: the committed migration (`20260527000012_gradebook.sql`) does not match the live table at all — the real columns are `teacher_id NOT NULL, description, max_marks, assessment_date`, none of the migration's `kind`/`weight`/`max_score`/`date`/`created_by_id`. Should be reconciled (a corrective migration, or at minimum a documented note) independent of Phase 0, since it risks confusing any future work that trusts the migration history.
- **The two existing report-card renderers disagree** on both scoring math (total-marks-ratio vs. average-of-percentages) and letter-grade boundaries (75/60/50/40 vs. 80/70/60/50) for the same student/term. A real, pre-existing data-integrity/trust issue, independent of CBC — worth a dedicated bug-fix pass.
- **Paystack webhook signature comparison isn't constant-time** (`!==` rather than `crypto.timingSafeEqual`) — cheap fix, worth folding into pentest preparation even outside formal Phase 0 scope. **Resolved in sub-sprint 2, 2026-07-27** — `PaymentsService.handleWebhook` now compares equal-length buffers via `crypto.timingSafeEqual` (length-mismatch short-circuits to a reject first, since `timingSafeEqual` throws rather than returning false on unequal lengths).
- **`payment_transactions.receipt_sent_at` is a dead column** (declared, never written) — sub-sprint 2's plan already folds in wiring this up rather than adding a redundant new column. **Resolved in sub-sprint 2, 2026-07-27** — `NotificationsService.dispatch()` now sets it (idempotently, `WHERE receipt_sent_at IS NULL`) once a `PAYMENT_RECEIVED`/`RECEIPT_AVAILABLE` notification is genuinely delivered; a companion `payment_paybill_transactions.receipt_sent_at` column was added from that table's birth so it never has the same dead-column problem; a one-shot migration backfilled existing `payment_transactions` rows from historical `email_sent_at`.
- **Payment audit logging is incomplete** — only the success path is logged today; no entry for initialization, failed reconciliation, or the manual `payment_records` admin-entry path. Sub-sprint 2's plan already folds in an opportunistic fix. **Resolved in sub-sprint 2, 2026-07-27** — `payment.initialized` and `payment.reconciliation_failed` audit entries added to the Paystack path, `payment_record.created` added to the manual `fees.service.ts` path, and every Paybill reconciliation status transition (matched/manually-matched/unmatched) is now audited via `payment_paybill.reconciliation_transition`.
- **`payment_records` (manual fee entry) and `payment_transactions` (online payment) are two disconnected tables** with no unified admin view — the existing reconciliation dashboard doesn't even show manually-recorded payments. Not asked for in Phase 0; Paybill reconciliation will make this fragmentation more visible (a third record-keeping path). A later-phase unification question, not this one's. **Still open, now three tables not two, 2026-07-27** — sub-sprint 2 added `payment_paybill_transactions` as a genuinely separate third record-keeping table (deliberately, per its own scope — unifying the three was explicitly out of scope) and, per the plan, built a read-only `GET /payments/unified` view + dashboard tab across all three specifically to make this fragmentation visible rather than to fix it. The underlying unification question is more urgent now, not less — flagged again here for owner prioritization.
- **Accessibility has been a written-down, unenforced policy** (`EXECUTION_PLAN.md`'s own "always-on tracks": *"every new screen passes axe DevTools before merge"*) — worth the owner knowing this is a policy-vs-practice gap, not just a one-time sweep needed.
- **`GET /health` is hardcoded `OK`** with no real DB check, unlike the rich SuperAdmin-only health endpoint. A status page watching a permanently-"OK" endpoint provides false assurance — sub-sprint 4's plan already folds in a minimal real check.
