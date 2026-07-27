# Phase 0, Sub-sprint 1: Communications Reach

**Goal.** Notifications reach parents on channels they actually use in Kenya — SMS and WhatsApp — not only email. Wire Africa's Talking and Meta WhatsApp Cloud API into the existing dispatcher, extend channel preferences, add cost tracking.

**Status.** Planning only. No code, migrations, or tests in this doc's own PR.

---

## 1. Current state audit

### The dispatcher

`apps/api/src/notifications/` has four files: `notifications.service.ts` (462 lines), `notifications.controller.ts`, `notifications.scheduler.ts`, `notifications.module.ts`.

- **Channels today: in-app (a DB row) and email (Brevo) only.** `NotifType` (`notifications.service.ts:6-17`) enumerates event types (`ABSENT_STUDENT`, `NEW_ANNOUNCEMENT`, etc.) — there is no channel enum at all. Channel logic is inline "email or not," not an abstraction.
- **Dispatch is async via a once-a-minute cron, not synchronous in-request.** `queue()` (`notifications.service.ts:71-92`) only inserts rows into `notifications`. `NotificationsScheduler` (`notifications.scheduler.ts:15`, `@Cron(CronExpression.EVERY_MINUTE) dispatch()`) calls `NotificationsService.dispatch()` (`notifications.service.ts:249-321`), which does the real sending and self-reports to `system_job_runs` for staleness detection.
- **`dispatch()` is the exact method a new channel attaches to.** It fetches rows where `email_sent_at IS NULL`, joins `notification_preferences` for `email_enabled` (lines 272-284), and calls the private `sendEmail()` helper (lines 436-461), which wraps one hardcoded Brevo client (`initBrevo()`, lines 56-68). There is no sender-strategy interface — Brevo is referenced by name throughout.
- **Existing stub, already in the code**: `queue()` pre-fills `sms_sent_at: now` on every inserted row, with the comment *"SMS not implemented; pre-fill so dispatcher skips this column"* (line 83). This is a deliberate placeholder for a column that already exists but is never really used. WhatsApp has no column at all yet.
- Two other call sites feed the same queue: `sendReportCardEmail()` (lines 336-403, sends email inline, then queues an in-app-only row) and `sendTest()` (lines 323-334, the admin "send test notification" feature).
- Controller routes (`notifications.controller.ts`): `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/read`, `PATCH /notifications/:id/acknowledge`, `POST /notifications/test`, `POST /notifications/report-card-email`, and a public HMAC-verified `GET /notifications/unsubscribe`.

### Channel preferences model

- `notification_preferences` (`supabase/migrations/20260526000009_notifications.sql:25-33`) already has `email_enabled BOOLEAN DEFAULT true` **and** `sms_enabled BOOLEAN DEFAULT false` (line 31). **`sms_enabled` is a dead column** — grepped the whole repo, it appears only in this migration file. No service reads or writes it.
- **There is no `whatsapp_enabled` column anywhere.**
- Backend: `apps/api/src/users/users.service.ts` — `getNotifPrefs()` (lines 62-68) selects only `notification_type, email_enabled`; `updateNotifPrefs()` (lines 70-104) accepts and writes only `email_enabled`.
- Frontend: `apps/web/app/(dashboard)/profile/ProfileClient.tsx` — a `NOTIF_TYPES` array (line 20) drives one row per category (lines 366-391): a fixed, non-interactive "In-app — always on" dot, and a single Email `role="switch"` toggle (lines 376-388). Copy states plainly: *"Choose which notifications you receive by email. In-app notifications are always on."* (line 362). No SMS or WhatsApp row exists in the UI.

### Prior SMS/WhatsApp attempts

**Nothing wired, env vars and doc mentions only.**

- `.env.example:49-52` / `.env:51-54` — blank placeholders: `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`.
- `RENDER_DEPLOYMENT.md:73-77` explicitly confirms: *"Redis, R2, Resend, and Africa's Talking/WhatsApp vars aren't referenced by any code yet, so skip them for now."*
- No SMS/WhatsApp SDK in `apps/api/package.json` (only `@getbrevo/brevo` for email). No dead/commented code — grepped for `sendSms`, `sendWhatsapp`, `SmsService`, `WhatsAppService`: zero matches.
- Planning docs repeatedly acknowledge the gap as a known, deliberate skip: `EXECUTION_PLAN.md:220` — *"Default: in-app on, email on (SMS/WhatsApp skipped — providers not set up)"*. `EXECUTION_PLAN.md:55` — WhatsApp Business API application shown `[~]` in progress, not complete. `ROADMAP.md:93-96` — an entirely unchecked "Week 9 — WhatsApp Business API" section, including "Fallback: SMS via Africa's Talking if WhatsApp fails."
- Supabase Auth's own `signInWithOtp({ phone })` (login page) is phone-OTP for **authentication**, a wholly separate mechanism from the notification dispatcher — not reusable here.
- `packages/types/src/schemas/announcement.ts:5` — code comment: *"Announcements - text-only in v0.1, distribution via email/SMS/WhatsApp in v0.2."* Confirmed: announcements are in-app only today.

### Cost tracking

**Missing entirely — and genuinely distinct from SaaS billing.** `apps/api/src/billing/` operates exclusively on `platform_invoices`/`school_subscriptions`/`packages` — the SuperAdmin's own subscription ledger for the SaaS business itself, gated by `SuperAdminGuard`. Nothing in it counts or prices individual messages. No per-message/per-notification cost or usage tracking exists anywhere in the schema.

---

## 2. Gap-to-goal analysis

| Goal | Gap size | Dependencies | Risk | Testability |
|---|---|---|---|---|
| SMS via Africa's Talking, wired into `dispatch()` | **M–L** | AT production account (sandbox likely unblocks dev work without it) | A bug in the send-trigger condition (e.g. a status-column mistake like the current pre-fill hack) could re-send and burn real money silently — needs a hard per-school cap or alert, not just correctness tests | e2e: `queue()` → `dispatch()` sends exactly one SMS per eligible notification per recipient with `sms_enabled=true`; running `dispatch()` twice never double-sends; a school with SMS disabled gets zero attempts |
| WhatsApp via Meta Cloud API, same dispatcher | **L–XL dev effort, but calendar-blocked 2–4 weeks** | Meta Business API approval **and a separate template-approval step** — WhatsApp cannot send free-text business-initiated messages; most notification types need a pre-approved template | Meta can reject the app review or specific templates; the "plain text only" anti-scope (below) collides with WhatsApp's template requirement for some message types and needs early design thought, not an afterthought | Same e2e shape as SMS; full send-path testing needs a live/sandbox WhatsApp test number from Meta |
| Extend channel prefs — SMS/WhatsApp toggles | **S–M** | Only meaningful once sending itself works | Low — this is mostly copying the existing Email `role="switch"` row pattern in `ProfileClient.tsx` | Prefs API round-trip test (matching the existing email-pref test shape); UI toggle persists and is read back correctly |
| Per-school-per-month cost tracking | **M–L** | None blocking | WhatsApp is billed by Meta per **24-hour conversation window**, not strictly per message — "cost per message sent," taken literally, doesn't map onto WhatsApp's actual pricing model. Design the schema around conversation-based billing or the numbers will misrepresent real spend | Send N SMS + open M WhatsApp conversations for a school in a test month, assert the aggregate matches expected cost for both billing models |

---

## 3. Implementation plan

**Migrations** (one per logical change):
1. `ALTER TABLE notification_preferences ADD COLUMN whatsapp_enabled BOOLEAN NOT NULL DEFAULT false` — `sms_enabled` already exists, no migration needed for SMS prefs.
2. `ALTER TABLE notifications ADD COLUMN whatsapp_sent_at TIMESTAMPTZ` (mirrors the existing `email_sent_at`/`sms_sent_at` shape).
3. New table `message_send_log(id UUID PK, school_id UUID NOT NULL REFERENCES schools(id), notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL, channel TEXT CHECK IN ('SMS','WHATSAPP'), provider TEXT, cost_amount NUMERIC(10,4), cost_currency TEXT DEFAULT 'KES', sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`.
4. (If per-school BYO credentials is the chosen model — see external dependencies — a `school_communication_settings` table for sender ID / phone number ID per school; skip entirely if a single shared platform credential is chosen instead.)

**RLS** (new tables only — existing tables' RLS is unaffected):
- `message_send_log`: `SELECT` for `ADMIN` where `school_id = current_school_id()`, plus `SUPER_ADMIN` unconditionally (for platform-wide cost analytics). No `INSERT`/`UPDATE`/`DELETE` policy — this table is written exclusively by the dispatcher via the service-role client, matching how `payment_transactions` writes work today.

**Tasks** (as they'd appear in the implementation prompt):
- Un-stub `queue()`: stop pre-filling `sms_sent_at`; let `dispatch()` genuinely decide per-recipient based on `sms_enabled`.
- Introduce a minimal channel-sender abstraction in `dispatch()` (not a new dispatcher — one more branch alongside the existing email branch, reading `sms_enabled`/`whatsapp_enabled` the same way `email_enabled` is read today).
- Africa's Talking client: a thin wrapper analogous to `initBrevo()`, using `AFRICASTALKING_USERNAME`/`AFRICASTALKING_API_KEY` (already reserved in `.env.example`).
- Meta WhatsApp Cloud API client: same shape, using `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` (already reserved).
- Write one `message_send_log` row per successful SMS/WhatsApp send, with the provider's reported cost if available, else a configured flat estimate.
- Extend `getNotifPrefs`/`updateNotifPrefs` (`users.service.ts`) to include `smsEnabled`/`whatsappEnabled`.
- Add two toggle rows to `ProfileClient.tsx`'s notification-preferences section, copying the existing Email switch pattern exactly.
- A simple admin-facing monthly cost summary (a new small section on an existing analytics page, or a standalone read-only view — implementation prompt should pick based on where it fits best in the current admin nav, not invent a new top-level page unless needed).

**Audit logs**: none for routine sends — matches this codebase's own established position (a prior PR's explicit instruction: "read events are too noisy to log by default" applies here just as much to routine message sends). Do log if/when SMS/WhatsApp becomes a per-school admin-toggleable config (not just a user preference) — that's an administrative action worth an audit trail, matching the convention used for other admin config changes.

**Cross-tenant test coverage plan**:
- A school with SMS/WhatsApp disabled at the school level (if a school-level kill switch exists) never gets a send attempt, regardless of individual user prefs.
- Per-school `message_send_log` aggregates never leak across schools in the cost-summary view.
- If per-school BYO credentials is chosen: school A's messages never send using school B's sender ID/phone number ID.

**Explicit anti-scope** (restated from the task spec — do not do these in this sub-sprint):
- No new dispatcher — extend `NotificationsService.dispatch()` only.
- No merging Announcements/Notifications/Messages/Platform Messages into one table.
- No queue system beyond the existing `@Cron(EVERY_MINUTE)` — if throughput becomes a real problem, that's a separate, later decision.
- No SMS providers besides Africa's Talking.
- No WhatsApp interactive messages (buttons, list responses) — plain text and links only.

---

## 4. External dependencies

| Dependency | Blocks implementation? | Notes |
|---|---|---|
| Africa's Talking production account + live short code | **Partial** | Sandbox likely available for dev; production account needed before real sends |
| Meta WhatsApp Business Cloud API approval | **YES** | 2–4 week lead time. Verify actual current status with the project owner directly — docs show an application marked "in progress," not confirmed complete. Must start immediately regardless of dev sequencing |
| WhatsApp message template design + Meta approval | **YES** (for WhatsApp specifically) | A separate, later approval step after the base API approval. Can be prepared mid-sprint while other work proceeds |
| **Human decision**: single platform-wide AT/WhatsApp credential vs. per-school BYO credentials | **YES** | Changes the schema, the cost-tracking model, and the whole billing relationship (platform pays and re-bills, vs. school pays directly). Must be decided before implementation starts |
| **Human decision/verification**: has the WhatsApp approval application actually been submitted yet? | **YES** | If not, "submit it" is the actual week-1 action item |
