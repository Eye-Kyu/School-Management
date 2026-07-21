# School Management Platform — Feature Roadmap

> **⚠️ RETIRED — superseded by [`EXECUTION_PLAN.md`](./EXECUTION_PLAN.md).**
> This document is stale (last updated 2026-05-25) and no longer reflects actual project status —
> `EXECUTION_PLAN.md` is the actively-maintained source of truth for what's shipped vs. planned.
> Kept here for historical reference only. Do not update this file going forward.

> Living document. Updated as each version ships.
> Status: `[x]` shipped · `[~]` in progress · `[ ]` planned · `[-]` deferred

---

## What's live today (v0.1 Weeks 1–5)

### Infrastructure & Auth
- [x] Turborepo monorepo — `apps/web` (Next.js 14), `apps/api` (NestJS), `packages/db`, `packages/types`
- [x] Supabase project (eu-west-2) — PostgreSQL + Auth + RLS
- [x] 14 database tables with full Row-Level Security on all tenant-owned tables
- [x] Multi-tenancy: every table scoped by `school_id`; RLS helper functions enforce isolation
- [x] Auth trigger: new Supabase signup → `public.users` row auto-created
- [x] Four roles: **ADMIN**, **TEACHER**, **STUDENT**, **PARENT**
- [x] Email + password login, phone OTP, password reset (Supabase magic link)
- [x] Role-based routing: middleware redirects each role to their dashboard
- [x] NestJS `AuthGuard` — validates bearer token, attaches `req.user` + `req.accessToken`
- [x] Audit log on every mutation

### Admin
- [x] Dashboard with colorful stat cards (classes, teachers, students, fee arrears)
- [x] Terms CRUD (name, start/end date, mark as current)
- [x] Classes CRUD (grade level, stream, soft delete)
- [x] Subjects CRUD (name, code)
- [x] Teachers CRUD (creates Supabase auth user + profile, returns temp password)
- [x] Students CRUD (creates auth user + profile, assigns to class)
- [x] Subject assignments (teacher → subject → class)
- [x] Timetable builder (day × time × subject × teacher × room, conflict detection)
- [x] Fee arrears CSV import + school-wide view (outstanding/billed/collected)
- [x] Announcements (post school-wide, by grade level, or by class; delete)

### Teacher
- [x] Dashboard with today's schedule card + weekly grid
- [x] Full weekly schedule detail page
- [x] Attendance marking — roster with Present/Absent/Late/Excused, idempotent re-submit
- [x] Announcements shown on dashboard

### Student
- [x] Dashboard with today's classes card + attendance rate card
- [x] Timetable detail page (full week, today highlighted)
- [x] Attendance detail page (rate bar + full history table)
- [x] Announcements shown on dashboard

### Parent
- [x] Dashboard with child's timetable card, attendance card, fee balance card, announcements card
- [x] Timetable detail page for linked child
- [x] Attendance detail page with rate bar
- [x] Fee balance detail page (per-term breakdown, payment progress bar)
- [x] Supports multiple linked children

### Demo data
- Admin: `admin@demo.school` / `ChangeMe123!`
- Teacher: `teacher@demo.school` / `Teacher123!`
- Student: `student@demo.school` / `Student123!`
- Parent: `parent@demo.school` / `Parent123!`

---

## v0.1 Remaining (Weeks 6–7 — Stabilisation)

> Goal: zero P0/P1 bugs, pilot school onboarded, teachers marking attendance for 2 consecutive weeks.

- [ ] Cross-tenant security test: School A user cannot read School B data
- [ ] Parent account creation UI (admin links parent → student)
- [ ] Student CSV bulk import (row-level error reporting)
- [ ] CI pipeline (lint + test + build on every PR)
- [ ] Deploy `apps/web` to Vercel, `apps/api` to Railway/Fly
- [ ] Sentry error tracking wired on both apps
- [ ] p95 page load < 2 s on mid-range Android over 3G
- [ ] Pilot school onboarding session (record it)
- [ ] `docs/runbooks/onboard-a-school.md`

---

## v0.2 — Daily Operations (Weeks 8–14)

**Mission:** Teachers and parents handle daily comms in-app instead of WhatsApp/phone.

### Week 8 — Notifications infrastructure
- [ ] Resend/Brevo account — transactional email
- [ ] `notifications` table: type, recipient_id, channel, status, sent_at
- [ ] Queue worker in NestJS (`@nestjs/bull` or simple interval)
- [ ] Email: attendance marked → parent notified same day
- [ ] Email: new announcement → all relevant users

### Week 9 — WhatsApp Business API
- [ ] Meta Cloud API integration (approval started in Week 1)
- [ ] WhatsApp message templates approved: attendance, fee reminder, announcement
- [ ] Fallback: SMS via Africa's Talking if WhatsApp fails
- [ ] Parent opt-in / opt-out for each channel

### Week 10 — Direct messaging (teacher ↔ parent)
- [ ] `messages` table: sender_id, recipient_id, body, read_at
- [ ] Teacher compose page: pick parent, write message
- [ ] Parent inbox: unread count badge, conversation thread
- [ ] Push notification on new message (web push API)

### Week 11 — School calendar
- [ ] `events` table: title, description, date, type (holiday, exam, sports, parent-day)
- [ ] Admin creates/edits events
- [ ] Calendar view on all dashboards (month grid + list)
- [ ] Events feed in notification system

### Week 12 — Online fee payment
- [ ] Integrate M-Pesa STK Push (Daraja API) for Kenya
- [ ] `payments` table: student_id, term_id, amount, mpesa_receipt, status
- [ ] Payment receipt page for parent
- [ ] Auto-update `fee_balances.amount_paid` on confirmed payment
- [ ] Admin payment reconciliation view

### Weeks 13–14 — Stabilisation v0.2
- [ ] Parent WhatsApp group goes quiet (success metric)
- [ ] 50%+ of term fees flow through platform
- [ ] Zero payment reconciliation incidents

---

## v0.3 — Academic Records (Weeks 15–21)

**Mission:** Digital homework submission, gradebook, report cards. Replaces printed reports.

### Gradebook
- [ ] `assessments` table: name, type (CAT, exam, assignment), max_score, term_id, subject_id
- [ ] `grades` table: assessment_id, student_id, score, teacher_id
- [ ] Teacher grade entry UI (bulk entry per assessment)
- [ ] Student grades view (per subject, per term)
- [ ] Grade statistics per class (mean, highest, lowest)

### Homework
- [ ] `homework` table: subject_id, class_id, due_date, description, attachments
- [ ] Teacher posts homework with optional file attachment (Supabase Storage)
- [ ] Student submission: text + file upload
- [ ] Teacher marks submission: status (submitted/late/missing) + comment
- [ ] Parent sees homework status for their child

### Report Cards
- [ ] Report card template (configurable per school)
- [ ] PDF generation (Puppeteer or React-PDF)
- [ ] Admin publishes report cards per term
- [ ] Parent downloads PDF from parent portal
- [ ] Student views online report card

### Quizzes (stretch)
- [ ] `quizzes` / `questions` / `quiz_attempts` tables
- [ ] Teacher creates multiple-choice quiz
- [ ] Student takes quiz, auto-scored
- [ ] Results added to gradebook

---

## v0.4 — Analytics & Compliance (Weeks 22–28)

**Mission:** School leadership makes data-driven decisions. Satisfies government reporting.

### Analytics dashboards
- [ ] Admin: school-wide attendance trend (line chart, weekly)
- [ ] Admin: class performance heatmap (grade × subject)
- [ ] Admin: fee collection rate by term
- [ ] Teacher: class attendance rate over time
- [ ] PostHog for product analytics (no PII)

### Behaviour & welfare
- [ ] `behaviour_logs` table: student_id, date, type (positive/negative), note, logged_by
- [ ] Teacher logs behaviour incident
- [ ] Admin overview of flagged students
- [ ] Parent notified of negative behaviour log

### Compliance
- [ ] GDPR data export: parent requests all data for their child (ZIP download)
- [ ] Audit log viewer for admin (filterable by user / action / date)
- [ ] Account deletion flow (soft-delete cascade)
- [ ] Data retention policy: auto-archive records > 7 years

### Permission slips
- [ ] `trips` table: name, date, cost, class_id
- [ ] Digital permission slip: parent approves/declines in portal
- [ ] Reminder if not signed by deadline

---

## v0.5 — Scale & Intelligence (Weeks 29+)

**Mission:** Mobile-first, AI-assisted operations. Ready for 10+ schools.

### Mobile apps
- [ ] React Native (Expo) app for teacher (attendance) and parent (timetable, fees, messages)
- [ ] Offline attendance marking with sync when back online
- [ ] Push notifications via Expo Push Service

### AI features (Claude API)
- [ ] Auto-timetabling: given teachers, subjects, classes → generate conflict-free timetable
- [ ] Early-warning system: flag students with >3 consecutive absences or falling grades
- [ ] Natural-language report card comments (teacher approves AI draft)
- [ ] Parent chatbot: "What homework does my child have this week?"

### Multi-school
- [ ] School group / district account (super-admin role)
- [ ] Cross-school reporting (aggregate stats, anonymised)
- [ ] White-label theming per school (logo, colours)
- [ ] Per-school billing (Stripe subscriptions)

### USSD (feature phones)
- [ ] Africa's Talking USSD integration
- [ ] Parent checks child's attendance: `*123*ADM001#`
- [ ] Teacher marks attendance via USSD when no smartphone available

### Bus tracking (stretch)
- [ ] `vehicles` + `routes` tables
- [ ] Driver app (React Native) sends GPS every 30 s
- [ ] Parent sees live bus location on map

---

## Deferred / Won't do in MVP

| Feature | Reason deferred |
|---|---|
| Online exam proctoring | Complexity, low demand in target market |
| Public API / webhooks | After v0.3 when data model stabilises |
| iOS/Android native (non-RN) | React Native covers the need |
| LMS integrations (Google Classroom) | v0.5+ |

---

*Last updated: 2026-05-25*
