# NEMIS/KEMIS export field verification

```
verified: false
verified_date: 2026-07-28
```

**This field list is NOT independently verified against an official Ministry of Education data-dictionary or bulk-upload template.** No such document is publicly discoverable — the actual upload template is gated behind a school's own logged-in NEMIS/KEMIS account. Everything below is sourced from public how-to-use-the-portal articles, not an official spec. **Before relying on this export for a real Ministry submission, an admin with real KEMIS portal access should confirm the exact field list, order, and accepted values against their own school's account.**

## Naming note

NEMIS (National Education Management Information System) was rebranded to **KEMIS** (Kenya Education Management Information System) in May 2025. Still commonly called "NEMIS" — this codebase's export endpoint, UI, and this doc all use that name for continuity, but KEMIS is the current live system.

## What this export produces

`GET /students/nemis-export?format=csv|xlsx` (admin-only, own-school-scoped, active students only) — CSV or XLSX, one row per student:

| Column | Source | Notes |
|---|---|---|
| AdmissionNo | `students.admission_no` | |
| GivenName / MiddleName / Surname | `users.full_name`, split heuristically | **Best-effort only** — this codebase has never stored a split name, only one `full_name` field. Split rule: first whitespace-separated token → given name, last token → surname, everything between → middle name. A single-word name has no surname; verify manually for any student whose name doesn't fit "given [middle] surname". |
| Gender | `students.gender` | |
| DateOfBirth | `students.date_of_birth` | |
| BirthCertificateNo | `students.birth_certificate_no` (new column) | Blank until an admin enters it — no bulk-import path for this yet, only the single-enrol form |
| UPINumber | `students.upi_number` (new column) | NEMIS/KEMIS *assigns* this on registration — it's not something a school invents. Expect this to be blank for every student until first registered with the Ministry; there's currently no UI to enter it after enrollment (see "Known gaps" below) |
| Nationality | `students.nationality` (new column) | |
| County | `students.county` (new column) | |
| SubCounty | `students.sub_county` (new column) | |
| Class | `classes.name` via `students.current_class_id` | |
| SpecialNeedsNotes | `students.special_needs_notes` (new column) | Free text; no UI to enter it yet (see "Known gaps") |
| GuardianName / GuardianPhone | `guardians` → `users`, first linked guardian | `guardians.is_primary` exists but isn't reliably set by any create flow today, so "first linked" is used rather than filtering on it |
| EnrollmentDate | `students.enrollment_date` | |

## Sourcing (public articles, not an official spec)

- [NEMIS portal: Login, registration, UPI number, and requirements — Tuko.co.ke](https://www.tuko.co.ke/266921-nemis-portal-login-registration-kenya.html)
- [NEMIS: How to Register & Track Learners' Performance in Kenya — Business Radar](https://www.businessradar.co.ke/blog/2024/10/10/nemis-how-to-register-track-learners-performance-in-kenya/)
- [NEMIS Portal: Login, Registration, UPI Number, and Requirements — TechMag](https://www.techmag.co.ke/2025/06/nemis-portal-login-registration-upi-requirements.html)

These confirm: full name, date of birth, birth certificate number (or a "Birth Not Yet Registered" placeholder), nationality, special-needs/conditions, and parent/guardian contact are commonly required. County/sub-county are not explicitly confirmed by these sources but are a standard part of Kenyan administrative/learner data collection generally — included here as a reasonable inference, not a confirmed requirement.

## Known gaps, not fixed in this PR

- **No admin UI to backfill NEMIS fields for a student *after* enrollment.** The single-enrol form (`/admin/students`) collects birth certificate no./nationality/county/sub-county at creation time only. UPI number and special-needs notes aren't collected in any UI yet — the backend `PATCH /students/:id` endpoint accepts them, but nothing in the frontend calls it with these fields. There is no general "edit an existing student" UI in this app at all today (a pre-existing gap, not introduced by this PR) — building one is out of scope here.
- **Whether NEMIS wants inactive/transferred-out students included** is not confirmed — this export follows every other export's convention (`is_active = true` only). Verify against a real KEMIS account before assuming this is correct for a Ministry submission.
- **Photo upload** — KEMIS registration reportedly requires a passport photo. This codebase has an `avatar_url` on `users` but this export doesn't include or validate it; out of scope for a CSV/XLSX export regardless (a photo isn't a spreadsheet cell).
