# Phase 0 Status Report — Internal (Engineering)

**Date:** 2026-07-29
**Audience:** engineering / project owner
**Status:** Phase 0 formally closed. See `docs/phase-0/00-master-plan.md` for the item-by-item Definition of Done and `docs/phase-1/00-backlog.md` for what comes next.

---

## 1. Executive summary

Phase 0 set out to close five named market-fit gaps for the Kenyan school market in an 8-week window: SMS+WhatsApp notifications, deeper M-Pesa (Paybill) support, CBC compliance tooling, NEMIS export + accessibility + security hardening, and a public status page. Three of the five sub-sprints shipped and are running against production Supabase with live e2e coverage: **1a (SMS)**, **2 (Paybill reconciliation + PDF receipts)**, and **4 (NEMIS export, accessibility, hardening)**. Two — **1b (WhatsApp)** and **3 (CBC compliance)** — never unblocked, because both depend on an external party (Meta Business API approval; KICD competency-list and sample-report-card verification) that didn't respond within the sprint window. Neither is a dev-effort gap; both are relocated to the Phase 1 backlog rather than left open-ended inside a "closed" phase.

This PR additionally closes two bugs surfaced by sub-sprint 4's own live e2e verification (one of which turned out to be a real, if narrow, production concurrency issue, not a test artifact) and formally documents the closure itself.

## 2. What shipped, by sub-sprint

**Sub-sprint 1a — SMS via Africa's Talking (2026-07-26).** Wired into the existing `NotificationsService.dispatch()` cron; no new dispatcher. Removed a legacy SMS stub, added retry-then-abandon lifecycle (up to 3 attempts, `sms_status` column). Per-school-per-month cost tracking surfaced on `/admin/analytics`. Channel preference toggle (`sms_enabled`) wired end-to-end. Scope-narrowed with the project owner during planning — a second "fee-due" SMS type was dropped since no triggering event exists in the codebase yet. A migration bug in the original task's own SQL (a non-`IMMUTABLE` index expression) was caught before it shipped.

**Sub-sprint 2 — M-Pesa Paybill reconciliation + PDF receipts (2026-07-27).** The largest single item in Phase 0. Per-school Paybill shortcodes (confirmed with the project owner) as the primary attribution key for Daraja C2B callbacks. New `payment_paybill_transactions` table (deliberately separate from `payment_transactions`), `MpesaDarajaService`, `PaybillReconciliationService` (exact admission-number match → suggest-only fuzzy fallback → overpayment/partial-payment detection), and on-demand PDF receipts via `pdfkit`. Admin dashboard gained an unmatched-transaction queue, an overpayment queue, and a read-only unified feed across all three payment tables. Surfaced a real, pre-existing gap independent of this sub-sprint: `20260529000019_payments.sql` (v0.2, week 12) had never actually been applied to production — applied by the project owner before this sub-sprint's own migrations were verified live. Two real bugs found and fixed during live e2e testing: missing `@HttpCode(200)` on both Daraja callback routes (would have caused Safaricom to retry every real callback), and a fuzzy-match fallback querying a `guardians.school_id` column that has never existed. Three audit items folded in and resolved: Paystack HMAC comparison now constant-time, `receipt_sent_at` wired up on both payment tables, payment audit logging completed across init/failure/manual-entry paths.

**Sub-sprint 4 — NEMIS export, accessibility, hardening, pre-CBC cleanup (2026-07-28).** The broadest single sub-sprint: NEMIS export (`GET /students/nemis-export`, admin-only, CSV/XLSX via a new `exceljs` dependency), a WCAG 2.1 AA sweep of 15 named pages via a repo-wide `eslint-plugin-jsx-a11y` ruleset plus manual fixes (icon-button labels, label/control association, two accessible-grid UIs, full dialog semantics on the two Paybill modals), a pentest-scope doc update, status-page code groundwork, a real `GET /health` DB check, an `assessments` schema-drift fix (the tracked migration file never matched the live table — turned out Prisma's own schema was already correct; only the migration file was wrong and had never run), reconciliation of two disagreeing report-card renderers (project owner confirmed the unweighted mean-of-percentages / 80-70-60-50 scheme as authoritative via a direct question, not assumed), and a from-scratch migration-parity tracking system (`_migration_log` table + `infra/scripts/check-migrations.sh`, now wired into CI) — prompted directly by the sub-sprint 2 migration-never-applied incident above.

## 3. What didn't ship, and why

- **WhatsApp (sub-sprint 1b).** Blocked on Meta Business API approval, which was never requested during this sprint's window (an owner action, not a dev task) and has a 2–4 week lead time once submitted. Relocated to `docs/phase-1/00-backlog.md`.
- **CBC compliance (sub-sprint 3).** Blocked on KICD competency-list and sample-report-card verification, requested from the project owner but not returned. Relocated to `docs/phase-1/00-backlog.md`. The grading-scheme standardization done in sub-sprint 4 (`packages/types/src/grading.ts`) is a real dependency this work can now build on rather than duplicate.
- **Public status page.** Code/placeholder groundwork is in place (README section, footer placeholder, real `GET /health` DB check), but the actual monitoring provider account (e.g. Better Stack) was never provisioned — an owner action.
- **Live provider verification for SMS and Paybill.** Both are code-complete and e2e-tested against production Supabase, but neither has processed a real message/transaction through a live Africa's Talking account or live Daraja production credentials in this environment. Both remain in sandbox/mock mode for anything touching the actual provider.

## 4. Known caveats

- **Payment data is fragmented across three tables** (`payment_records`, `payment_transactions`, `payment_paybill_transactions`) with no unified write path — only a read-only unified view. Flagged repeatedly across sub-sprints 2 and 4's audit notes; more urgent now that a third table exists, not less. A later-phase unification question.
- **Accessibility is a policy-vs-practice gap that this sprint could only partially close.** Every statically-findable issue on the 15 named pages is fixed, and the `jsx-a11y` lint ruleset is now explicit repo-wide — but this environment has no browser, so no page has been run through actual axe DevTools or a screen reader. `docs/audits/accessibility-follow-ups.md` documents exactly what static analysis could and couldn't verify.
- **Two bugs open in `docs/bug-triage.md`** from before this sprint (BUG-1: a roleless/soft-deleted session isn't redirected away from dashboard shells — no data exposure, RLS still blocks every query; BUG-2: a blocked remark-request review returns a misleading success). Both are correctness bugs, not cross-tenant leaks, and both are out of scope for Phase 0 — untouched by this PR.
- **This closure PR's own migration (`20260728000075`) needs to be applied before the new SMS-dispatcher concurrency fix can be exercised live** — see Recommendations below.

## 5. Metrics

- **Sub-sprints shipped:** 3 of 5 (1a, 2, 4), plus this closure PR, across 2026-07-26 through 2026-07-29.
- **Migrations:** 76 total, tracked via `_migration_log` (backfilled for all 72 pre-existing files as of sub-sprint 4; +3 from sub-sprint 4 itself; +1 from this closure PR).
- **Unit tests:** 127/127 passing, `apps/api`. 43/43 passing, `apps/web`.
- **Live e2e (2026-07-29, against production Supabase):** `cross-tenant.e2e-spec.ts` 150/151 on the full run — the 1 failure was a scoping bug in a newly-added regression test (used a `beforeAll`-local helper from outside its closure), fixed immediately and reverified 1/1 passing in isolation. `nemis-export.e2e-spec.ts` + `payments-paybill.e2e-spec.ts` reverified live after the fixture change — 14/14 passing. `notifications-sms.e2e-spec.ts` — 7/7 passing after migration `20260728000075` was applied, including the new BUG-4 concurrency regression test; one intermediate failure surfaced and was fixed along the way (a new test's hardcoded phone number collided with a pre-existing test's, both in the same school, tripping the `(school_id, phone)` unique constraint — a test-fixture bug, not a dispatch-logic bug).
- **CI:** migration-parity check (`infra/scripts/check-migrations.sh`) now runs unconditionally on every PR, alongside the pre-existing RLS check.

## 6. What Phase 1 opens with

Five items, none started, ordered by external-dependency-unblock rather than a fixed schedule — full detail in `docs/phase-1/00-backlog.md`:

1. **WhatsApp** — resumes once Meta Business API approval lands (needs submitting first).
2. **CBC compliance** — resumes once KICD content verification returns.
3. **Biometric attendance (ZKTeco F18)** — no external blocker, but no planning doc exists yet.
4. **Offline-first PWA** — no external blocker, no planning doc yet.
5. **Swahili (or other local-language) UI** — no external blocker, no planning doc yet; needs a translation-ownership decision first.

## 7. Recommendations

1. ~~Apply migration `supabase/migrations/20260728000075_notifications_sms_status_sending.sql`~~ — **done.** Applied and verified live: `notifications-sms.e2e-spec.ts` 7/7 passing, including the new BUG-4 concurrency regression test.
2. **Submit the Meta WhatsApp Business API application now**, independent of any other Phase 1 sequencing decision — its 2–4 week lead time means the earlier it's requested, the sooner sub-sprint 1b can actually start.
3. **Send the KICD competency-list and sample-report-card request again** if it hasn't had a response — CBC compliance can't be scoped, let alone started, without it.
4. **Provision live provider accounts** (a real Africa's Talking account, live Daraja production credentials, a status-page monitoring provider) — all three are pure owner/paperwork actions blocking the "real pilot school" bar on otherwise-complete, e2e-tested infrastructure.
5. **Keep the migration-parity workflow live** — `infra/scripts/check-migrations.sh` before checking off any migration-touching item in `EXECUTION_PLAN.md`, matching the new rule added to that file's own "How to use this file" section. Two real never-applied-migration incidents this sprint (the `assessments` drift and the sub-sprint 2 `payments.sql` gap) is what prompted building it — don't let the check lapse into unenforced policy the way the accessibility one did.
