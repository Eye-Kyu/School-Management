# Phase 0, Sub-sprint 2: M-Pesa Deepening

**Goal.** M-Pesa is the primary payment channel for Kenyan schools. Handle both STK Push (app-initiated) and Paybill/Till reconciliation (parent-initiated, outside the app) natively, with automatic reconciliation and PDF receipts.

**Status.** Planning only. No code, migrations, or tests in this doc's own PR.

**Implemented, 2026-07-27 (sub-sprint 2 PR).** Shipped with two deliberate departures from this doc's own proposal, decided during implementation planning: (1) Paybill transactions live in a new, separate `payment_paybill_transactions` table rather than extending `payment_transactions` with nullable identity columns — the schema-extension approach above (§3) would have meant every existing Paystack-path query defensively null-checking `student_id`/`parent_user_id`/`fee_balance_id`, whereas a dedicated table keeps the two payment sources' invariants independent (and this doc's own §2 gap table already flagged that a second table would "fragment reconciliation the same way `payment_records` already does" — accepted as a known, explicit tradeoff rather than an oversight, and made visible rather than hidden via the new unified read-only view below). (2) PDF receipts use `pdfkit` (a plain Node drawing library), not Playwright's `page.pdf()` as §3 proposed — this exact environment hit a build-time OOM once already this session, and a NestJS backend endpoint has no need for a full headless browser just to draw a fixed-layout document. Per-school Paybill shortcodes (not one shared shortcode) was the human decision §4 flagged as required — confirmed with the project owner. See `EXECUTION_PLAN.md` (Phase 0, sub-sprint 2 entry) for the full implementation summary, and `00-master-plan.md`'s "Gaps discovered during audit" section for which of this doc's adjacent findings (Paystack HMAC timing, `receipt_sent_at`, incomplete audit logging) were folded in and resolved.

---

## 1. Current state audit

### Current payment integration

**Processor: Paystack only**, via raw `fetch` calls — no SDK dependency at all (`apps/api/package.json` has no `paystack`/`flutterwave`/`stripe`/`mpesa` package).

- `apps/api/src/payments/payments.service.ts:63` — `initializePayment` calls `https://api.paystack.co/transaction/initialize` directly.
- `payments.service.ts:118` — `verifyAndReconcile` calls `https://api.paystack.co/transaction/verify/:reference`.
- `.env.example:54-58` — only `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY`. No Daraja/M-Pesa credentials anywhere.
- **Sandbox vs. production**: `EXECUTION_PLAN.md:208` flags this explicitly — code-complete, blocked only on a real Paystack account/keys.
- **There is no direct Safaricom Daraja/M-Pesa integration.** Today's "M-Pesa support" is Paystack's own hosted checkout, which can surface an M-Pesa channel to the payer (`EXECUTION_PLAN.md:209`; the receipt page hardcodes *"Online (M-Pesa / Card via Paystack)"*). `ROADMAP.md:112` still lists direct Daraja STK Push as unchecked — the team's own roadmap treats it as distinct, not-yet-done work.
- **Flow**: browser → `POST /payments/initialize` (NestJS) → Paystack REST, server-side, with the secret key → `authorizationUrl` returned → browser redirects to Paystack's hosted page → Paystack redirects back to a callback URL → frontend calls `GET /payments/verify/:reference`. No client-side Paystack.js anywhere in `apps/web`.

### Webhook handling

Full handler: `payments.controller.ts:39-48` (`POST /payments/webhook/paystack`, public, no `AuthGuard`) → `payments.service.ts:93-113`.

- **Signature verification exists**: HMAC-SHA512 over the raw body using `PAYSTACK_SECRET_KEY`, compared against `x-paystack-signature` (lines 96-106). Matches Paystack's documented scheme.
  - Gap: the comparison (`if (expected !== signature)`, line 103) is a plain string `!==`, not `crypto.timingSafeEqual` — a timing side-channel, not currently exploitable in a way that blocks this sub-sprint, but worth fixing (see "gaps discovered" in the master plan).
- **Idempotent**: `reconcilePayment` (lines 126-133) short-circuits `if (!txn || txn.status === 'SUCCESS') return;` — replaying an already-`SUCCESS` webhook is a no-op, no double-credit. Holds for both the webhook path and the `verifyAndReconcile` polling path, since both funnel through `reconcilePayment`.
  - This works only because there's a single event type today — no dedicated idempotency-key ledger exists.
- **The existing "HMAC-signed webhook registry"** (Week 26, `dispatchWebhookEvent` etc., `payments.service.ts:238-287`) is a *different, outbound* mechanism (school → third-party integrations, HMAC-SHA256, per-endpoint secret) — it does not transfer to a new *inbound* M-Pesa Paybill callback, which needs its own security scheme (Safaricom Daraja doesn't do shared-secret HMAC the same way; it relies on IP-restricted confirmation/validation URLs).

### Reconciliation today

**Paybill/Till-style unauthenticated matching is missing entirely.** Every existing transaction starts from an authenticated parent picking their own `feeBalanceId` *before* paying (`payments.service.ts:16-90`) — the webhook only looks up by an app-generated `reference` (`sm_${uuid}`), never by admission number, phone, or M-Pesa receipt code.

A separate, unrelated table, `payment_records` (`apps/api/src/fees/fees.service.ts:141-189`, migration `20260526000007_payment_records.sql`), is purely manual admin bookkeeping — an admin types in "parent paid via M-Pesa, ref XYZ." No webhook, no automated matching. The admin reconciliation dashboard (`apps/web/app/(dashboard)/admin/payments/page.tsx:11-16`) queries only `payment_transactions` — it doesn't even surface `payment_records` rows. `payment_transactions.status` has no `UNMATCHED` state.

### PDF/receipt generation

**Missing entirely, everywhere.** No PDF library in either `package.json` (Playwright exists only as a web **devDependency** for e2e tests, not PDF rendering).

- Both report-card pages (`apps/web/app/report-card/[studentId]/page.tsx`, `apps/web/app/print/report-card/[studentId]/page.tsx`) are plain HTML with Tailwind `print:` classes and a `PrintButton` calling `window.print()` — one literally instructs "choose Save as PDF" in the print dialog.
- **The receipt page already exists**: `apps/web/app/print/receipt/[paymentId]/page.tsx` (83 lines). RLS-scoped direct Supabase query (bypasses NestJS), renders a receipt as HTML, same `window.print()` pattern, hardcodes the payment-method text.
- `payment_transactions.receipt_sent_at` exists as a column but is **never written anywhere** — a dead column.
- The payment-success notification reuses the `NEW_ANNOUNCEMENT` notif type (no dedicated `PAYMENT_RECEIPT` type exists) and the Brevo email client has no attachment field — "delivery" today is a link to the browser-print page, not an emailed PDF.

### `payment_transactions` schema

`supabase/migrations/20260529000019_payments.sql:5-24`:

```
payment_transactions(
  id, school_id, student_id, parent_user_id, fee_balance_id,
  provider TEXT DEFAULT 'PAYSTACK',
  reference TEXT UNIQUE,            -- app-generated, NOT an M-Pesa receipt number
  amount, currency DEFAULT 'KES',
  status CHECK IN ('PENDING','SUCCESS','FAILED','ABANDONED'),
  provider_payload JSONB,            -- raw webhook/verify response dump
  receipt_sent_at,                   -- declared, never written (see above)
  created_at, updated_at
)
```

**No dedicated M-Pesa-receipt-number column** — one would today only end up buried inside `provider_payload`'s JSON blob, not queryable/indexable. The manual-entry sibling table `payment_records` has a free-text `reference_no` column with no uniqueness constraint and no FK.

**Audit logging**: only the success path is logged (`payments.service.ts:164-172`, action `fee.paid`) — no log entry for initialization, failed reconciliation, or the manual `payment_records` path. `audit_logs.ip_address` exists but is never populated by payments code.

### RLS on payment tables

`20260529000019_payments.sql:52-71`:

```sql
CREATE POLICY "pt_select" ON payment_transactions FOR SELECT USING (
  school_id = current_school_id() AND (current_user_role() = 'ADMIN' OR parent_user_id = current_user_id())
);
CREATE POLICY "pt_insert" ON payment_transactions FOR INSERT WITH CHECK (school_id = current_school_id());
CREATE POLICY "pt_update" ON payment_transactions FOR UPDATE USING (school_id = current_school_id());
```

`pt_insert`/`pt_update` have **no role or ownership check at all** — school-scoped only. Moot today because every actual write in `payments.service.ts` goes through the service-role client (`supabase.admin`), bypassing RLS entirely; only the two read paths use the RLS-scoped client. No `pt_delete` policy exists (defaults to denied). `fee_balances_update_admin_only` is ADMIN-only — any new unauthenticated Paybill webhook must use the service-role client to touch `fee_balances`, exactly as `reconcilePayment` already does. `payment_records` SELECT is school-wide with no parent-ownership restriction (unlike `payment_transactions`), INSERT is ADMIN-only, no UPDATE/DELETE policy at all.

---

## 2. Gap-to-goal analysis

| Goal | Gap size | Dependencies | Risk | Testability |
|---|---|---|---|---|
| Verify Paystack STK Push is production-ready | **S** | Live Paystack merchant account (blocks live testing only) | Low — no hardcoded sandbox-only branches found; re-verify during implementation before assuming | Smoke test against a real account once keys exist; no code change anticipated |
| Paybill/Till reconciliation (C2B ingestion + matching) | **XL — the largest single gap in all of Phase 0** | Safaricom Daraja API credentials (hard blocker); human decision on shared-shortcode vs. per-school-Paybill architecture | Money-handling correctness: a matching bug could credit the wrong student; an under-secured unauthenticated endpoint could accept a spoofed "payment happened" callback | e2e: exact-match credits the right student only; no-match creates an unmatched record and touches no fee balance; duplicate callback (same M-Pesa receipt) is idempotent; cross-tenant isolation on the match |
| Automatic PDF receipts, delivered via chosen channel | **M–L** | None external | Headless rendering (Playwright, already a devDependency — the natural reuse) adds real memory/CPU per generation; this exact environment already hit a build-time OOM this session — needs headroom awareness, ideally a queue rather than inline generation | Generate a receipt for a known transaction, assert it's a valid PDF containing the right reference/amount, assert access is as RLS-gated as the existing receipt page |
| Reconciliation dashboard: unmatched payments + manual match | **M** | Needs the reconciliation goal above to land first | A manual-match action is a privileged, money-affecting admin action — needs its own audit log entry, closing an adjacent gap (even the automated path is under-audited today) | e2e: ADMIN can match an unmatched payment to the right student, correctly credits the fee balance, audit-logs the action; cross-tenant — cannot match another school's unmatched payment |

---

## 3. Implementation plan

**The core design decision.** `payment_transactions` today hard-requires `student_id`/`parent_user_id`/`fee_balance_id` (`NOT NULL`) because every existing row starts from an authenticated parent picking their own child. A Paybill payment arrives with no pre-existing row and no known student. The right shape is to extend this one "money received" table — nullable identity columns + a match-status concept — rather than fork a second table, since a second table would immediately fragment reconciliation the same way `payment_records` already does today (see "gaps discovered," master plan).

**Migrations** (one per logical change):
1. `ALTER TABLE payment_transactions ALTER COLUMN student_id DROP NOT NULL, ALTER COLUMN parent_user_id DROP NOT NULL, ALTER COLUMN fee_balance_id DROP NOT NULL` — verify no existing code path assumes non-null before this lands.
2. `ALTER TABLE payment_transactions ADD COLUMN match_status TEXT NOT NULL DEFAULT 'MATCHED' CHECK (match_status IN ('MATCHED','UNMATCHED','MATCHED_MANUALLY'))` — default keeps every existing row unaffected.
3. `ALTER TABLE payment_transactions ADD COLUMN raw_reference TEXT` + a unique index where not null (Safaricom's own M-Pesa receipt number — idempotency key for Paybill callbacks specifically, distinct from the app-generated `reference`).
4. `ALTER TABLE payment_transactions ADD COLUMN receipt_pdf_url TEXT` — and start actually writing to the existing `receipt_sent_at` column rather than adding a redundant new one for that purpose.
5. Extend the `provider` check constraint to allow `'MPESA_PAYBILL'` alongside `'PAYSTACK'`.

**RLS**: no new SELECT policy needed — `pt_select` already covers ADMIN seeing every row in their school regardless of `match_status`. The Paybill inbound webhook uses the service-role client exactly like the existing Paystack webhook (there is no session for an unauthenticated C2B callback) — same established pattern, nothing new to write. Worth tightening `pt_insert`'s current no-ownership-check looseness defensively while touching this table anyway (moot today since service-role bypasses it, but nullable-identity rows raise the stakes slightly).

**Tasks** (as they'd appear in the implementation prompt):
- New inbound webhook route for Safaricom Daraja C2B confirmation/validation callbacks, secured by IP allowlisting to Safaricom's published ranges (Daraja's actual security model, distinct from Paystack's HMAC scheme).
- Matching logic: parse the callback's account-reference field, exact-match against `students.admission_no`; on match, credit the right `fee_balances` row via the service-role client (mirroring `reconcilePayment`'s existing credit logic — reuse it, don't duplicate it); on no match, insert with `match_status = 'UNMATCHED'` and no `fee_balance_id`.
- Reconciliation dashboard: extend `admin/payments/page.tsx` with an "Unmatched" filter/tab and a "match manually" action (admin picks a student, the app sets `fee_balance_id`/`student_id`/`parent_user_id` and `match_status = 'MATCHED_MANUALLY'`, then credits `fee_balances` through the same shared credit function used by the automated path).
- PDF receipt generation: reuse the existing `print/receipt/[paymentId]` page's layout, rendered server-side via Playwright (`page.pdf()`) rather than relying on the user's browser; store the resulting file (Supabase Storage, matching the pattern already used for document library / report cards) and set `receipt_pdf_url` + `receipt_sent_at`.
- Wire the receipt link into the existing notification-on-payment-success flow, using a real `PAYMENT_RECEIPT` notif type instead of repurposing `NEW_ANNOUNCEMENT`.

**Audit logs**: `payment.manual_match` (required, new). Optionally close the adjacent pre-existing gap — no log today for payment initialization or failed reconciliation — while already touching this module.

**Cross-tenant test coverage plan**:
- An exact-match Paybill payment credits the right student/school only.
- A garbled/no-match reference creates an `UNMATCHED` row and touches no `fee_balances` row.
- A duplicate callback (same M-Pesa receipt number) is idempotent.
- An ADMIN can only manually match their own school's unmatched rows, never another school's.

**Explicit anti-scope** (restated from the task spec):
- No rewrite of the Paystack integration.
- No card-first pricing tiers or forced card payments.
- No cryptocurrency, bank-transfer batch imports, or any payment method not already in the system.
- No SaaS-subscription auto-collection for the platform's own billing (Phase 2+).

---

## 4. External dependencies

| Dependency | Blocks implementation? | Notes |
|---|---|---|
| Paystack production merchant account | **No** | Sandbox suffices for dev; blocks live testing of the existing flow only |
| Safaricom Daraja API credentials | **YES** | Hard blocker for the entire Paybill reconciliation goal. The task's own framing ("parent pays directly to the school's Paybill number without going through the app") confirms this needs direct Daraja integration — Paystack has no visibility into a payment that never touched it |
| Test M-Pesa Paybill number for reconciliation testing | **YES** | Needed for true end-to-end verification; a Daraja sandbox environment likely exists but wasn't independently confirmed this pass |
| **Human decision**: one shared Paybill/shortcode across all schools (parse a combined school+student reference) vs. each school registering its own Paybill number with Safaricom | **YES** | Fundamentally different architecture — must be decided before implementation, not assumed |
