# Shared Helpers Call-Site Audit

**Scope:** Foundation PR, Phase 1 — precise call-site inventory for extracting attendance-rate, approved-absence-overlay, and per-student term-average calculations into shared helpers, prerequisite to Student 360 (B1-4a). Motivated by findings #2/#6/#7 of `docs/audits/student-360-data-sources.md`.

**Status:** Phase 1 (audit) complete. **No code changes in this PR.** Awaiting explicit review before Phase 2 implementation starts.

## Summary

| Finding | |
|---|---|
| Attendance-rate call sites | 9 total, all re-verified directly today |
| **Correction to the prior audit**: LATE-handling is not actually inconsistent | 8 of 9 sites were mis-cited as "PRESENT only" — they already count `PRESENT+LATE`. The LATE-counting rule change is a **no-op** everywhere |
| The real, sole source of displayed-value change | The approved-absence overlay, applied at **zero of the 9 sites today**. Adopting it will move every site's rate **up**, never down |
| Term-average call sites | 3 total (2 known report-card renderers + 1 newly found in the gradebook's on-screen table and CSV export) |
| Approved-absence overlay | Exists in exactly one place today (`AttendanceService._approvedAbsenceStudentIds`), single-date only, deliberately uses the service-role client |
| **Architectural fork requiring sign-off** | STUDENT has zero RLS grant on `absence_requests`; PARENT is granted only for requests *they personally submitted*. Two student-facing and one parent-facing page cannot apply the overlay via their existing direct-Supabase-query pattern at all |
| Package location | `packages/lib` does not exist. Recommend `packages/types/src` (the one established shared-code convention), pure functions only — not the task's literal `db`-accepting signatures |

---

## 1.1 Attendance-rate call sites

All 9 re-read directly today (not trusted from the prior audit's own citations, which were stale on this point).

| # | File:line | Formula | Overlay applied? |
|---|---|---|---|
| 1 | `apps/api/src/ai/ai.controller.ts:98-113` | `PRESENT+LATE` | No |
| 2 | `apps/web/app/(dashboard)/admin/analytics/page.tsx:52-70` | `PRESENT+LATE` (per-class and school-wide) | No |
| 3 | `apps/web/app/(dashboard)/teacher/analytics/page.tsx:70-121` | `PRESENT+LATE` (weekly trend + per-student at-risk flag) | No |
| 4 | `apps/web/app/(dashboard)/student/analytics/page.tsx:73-99` | `PRESENT+LATE` | No |
| 5 | `apps/web/app/(dashboard)/student/page.tsx:62-66` | `PRESENT+LATE`, rounded | No |
| 6 | `apps/web/app/(dashboard)/student/attendance/page.tsx:47-52` | `PRESENT+LATE`, rounded | No |
| 7 | `apps/web/app/(dashboard)/parent/page.tsx:64-68` | `PRESENT+LATE`, rounded | No |
| 8 | `apps/web/app/(dashboard)/parent/attendance/page.tsx:52-57` | `PRESENT+LATE`, rounded | No |
| 9 | `apps/web/app/print/report-card/[studentId]/page.tsx:72-83` | `PRESENT+LATE`, rounded | No |

Representative snippet (site 6, verified directly):
```ts
const total = (records ?? []).length;
const present = (records ?? []).filter((r) => r.status === 'PRESENT').length;
const late = (records ?? []).filter((r) => r.status === 'LATE').length;
const absent = (records ?? []).filter((r) => r.status === 'ABSENT').length;
const excused = (records ?? []).filter((r) => r.status === 'EXCUSED').length;
const rate = total > 0 ? Math.round(((present + late) / total) * 100) : null;
```

**All 9 already compute `(PRESENT + LATE) / total`.** Sites 6 and 8 additionally display an "Excused" stat card — but it counts literal `status === 'EXCUSED'` rows (verified directly), which are essentially nonexistent in practice, since `EXCUSED` is a **read-time overlay** applied by `AttendanceService.roster()` (§1.3) — no `attendance_records` row is ever *written* with that status for an approved absence. That stat card is not, and has never been, the real approved-absence count.

**None of the 9 sites query `absence_requests` at all.** Confirmed by reading each file's full query — every one is a single `.from('attendance_records')...` call, nothing joins or separately queries the approval table.

### Correction to `docs/audits/student-360-data-sources.md`

That audit's §1.2 table classified 5 of these 9 sites as "PRESENT only." Re-reading the actual current files shows only 1 of 9 (site 1) was ever correctly PRESENT+LATE per that table, and the other 8 — including all 4 it labeled "PRESENT only" and one more it hadn't listed a formula for — are also `PRESENT+LATE`, not `PRESENT` alone. This may reflect the files having changed since that audit's research pass, or a research error in that pass; either way, the practical conclusion changes: **there is no LATE-handling inconsistency left to fix.** The task's own framing ("9+ ad-hoc sites, inconsistent LATE handling") should be read as **historically accurate but no longer descriptive of the current codebase** — worth stating in the PR description so pilot schools aren't told to expect a LATE-driven number change that won't happen.

---

## 1.2 Term-average call sites

### `apps/web/app/report-card/[studentId]/page.tsx:74-87`
```ts
const subjectAverages = subjectGroups.map((g) =>
  calculateSubjectAverage(
    g.rows.filter((r) => r.marks_obtained != null)
      .map((r) => ({ score: Number(r.marks_obtained), maxMarks: (r.assessment as any)?.max_marks ?? 0 })),
  ),
);
const scoredSubjectAverages = subjectAverages.filter((a): a is number => a != null);
const grandPct = scoredSubjectAverages.length > 0
  ? scoredSubjectAverages.reduce((s, a) => s + a, 0) / scoredSubjectAverages.length
  : null;
```
Per-subject via the shared `calculateSubjectAverage` (`packages/types/src/grading.ts`), then an inline unweighted mean of subject averages for the overall figure. **Reads `grades` only** — no query against `homework_completions`/`quiz_attempts` for unlinked scores.

### `apps/web/app/print/report-card/[studentId]/page.tsx:64-70,104-106`
Same shape, **independently reimplemented** — doesn't share the "mean of subject averages" step with its sibling above, only the per-subject `calculateSubjectAverage` call itself. Also `grades`-only.

### `apps/web/app/(dashboard)/teacher/gradebook/GradebookClient.tsx:140-150` — not previously identified, found per the task's own "check gradebook exports" instruction
```ts
function studentAvg(studentId: string): string {
  const scored = assessments
    .map((a) => ({ score: grades[a.id]?.[studentId], max: a.max_marks }))
    .filter((x) => typeof x.score === 'number');
  if (!scored.length) return '—';
  const avgPct = scored.reduce((s, x) => s + (x.score! / x.max) * 100, 0) / scored.length;
  return `${avgPct.toFixed(1)}%`;
}
```
A **fourth** independent copy of the identical unweighted-mean-of-percentages math — doesn't call `calculateSubjectAverage` at all. Used in **two** places, not just the CSV export as the task's phrasing implied: the on-screen gradebook table's own average column (`:326`) and the CSV export row data (`:198`). Client-side (`'use client'` component), scoped to one class/subject at a time (this is the per-class gradebook, not a cross-subject report), so it's closer to a `calculateSubjectAverage` consumer than a term-average one — but it reimplements the formula rather than importing it, which is exactly the kind of duplication this PR exists to close.

**All three sites read `grades` only** — none reconciles unlinked `homework_completions`/`quiz_attempts` scores. This is a real, independent migration-risk direction (see §1.4): once `calculateStudentTermAverage` unions all three sources per the task's Task 4 spec, any student with graded-but-not-linked homework/quiz work will see their average **change** (direction depends on whether their unlinked scores are above or below their currently-visible average — unlike the attendance finding, this one isn't uniformly directional).

---

## 1.3 Approved-absences overlay call sites

**Exactly one implementation exists today**, and it is the audit's central finding.

`apps/api/src/attendance/attendance.service.ts:82-94` (`_approvedAbsenceStudentIds`, private, single-date):
```ts
// Students in `studentIds` who have an APPROVED absence_requests row
// covering `date`. No attendance_records rows are ever written for these
// dates — the EXCUSED status is computed here, at read time, only.
private async _approvedAbsenceStudentIds(studentIds: string[], date: string): Promise<Set<string>> {
  const { data } = await this.supabase.admin
    .from('absence_requests')
    .select('student_id')
    .in('student_id', studentIds)
    .eq('status', 'APPROVED')
    .lte('start_date', date)
    .gte('end_date', date);
  return new Set((data ?? []).map((r) => r.student_id));
}
```
Used only by `roster()` (the teacher-facing single-day class roster) to overlay `{status: 'EXCUSED', note: 'Approved absence'}` for students with no real row that date, and as a write-blocking gate in `mark()`. **Deliberately uses `this.supabase.admin`** (service-role) — its own comment states why: `absence_requests` RLS doesn't grant every subject teacher who marks attendance SELECT access to it.

### The architectural fork: `absence_requests_select` RLS, verified directly (`supabase/migrations/20260725000065_absence_requests.sql:47-69`)

```sql
CREATE POLICY "absence_requests_select" ON public.absence_requests FOR SELECT
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR requested_by_user_id = public.current_user_id()
      OR EXISTS ( -- student's Class Teacher
        SELECT 1 FROM public.students s
        JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = absence_requests.student_id AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
      OR EXISTS ( -- any subject teacher assigned to the student's class
        SELECT 1 FROM public.students s
        JOIN public.subject_assignments sa ON sa.class_id = s.current_class_id
        JOIN public.teachers t ON t.id = sa.teacher_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = absence_requests.student_id AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
    )
  );
```

**There is no branch for "I am the student this request is about," and `requested_by_user_id = current_user_id()` only matches the *specific* parent who submitted that particular request** — not "any guardian linked to this student" (the INSERT policy, `:72-78`, confirms a request's `requested_by_user_id` is always set to whichever parent submitted it; a second guardian on the same student who didn't personally submit a given request has no grant to see it).

**Direct, concrete implication**: `apps/web/app/(dashboard)/student/attendance/page.tsx` (site 6) and `apps/web/app/(dashboard)/parent/attendance/page.tsx` (site 8) — both server components using the caller's own RLS-scoped Supabase client — **cannot** apply the overlay by simply querying `absence_requests` themselves the way they query everything else. A student querying it sees zero rows, always. A parent sees only the requests they personally submitted, not necessarily all of their child's approved absences if multiple guardians exist. `student/page.tsx`/`parent/page.tsx` (sites 5, 7 — today-only status widgets) have the identical constraint if they're ever extended to show a rate.

**No existing API endpoint exists that these pages could switch to instead** — confirmed via a repo-wide check of `apps/api/src` for any student/parent-facing attendance-summary route; none exists. Every one of sites 5-8 talks to Supabase directly today, with zero NestJS involvement.

**This is the one decision Phase 2 needs the reviewer to confirm, not something this audit resolves silently.** Two options:
- **(a) A new NestJS endpoint** (e.g. `GET /attendance/my-summary`, self-service, using `this.supabase.admin` internally after verifying the caller is the student themself or a linked guardian) that sites 5-8 call instead of querying Supabase directly. Mirrors the exact pattern `AttendanceService` already uses for the teacher-facing overlay — same trust boundary, same client choice, just a new caller-facing route.
- **(b) Widen `absence_requests_select`** to also grant the student themself and any guardian of the student (via `guardian_student_ids()`, the same function `absence_requests_insert` already uses), not just the original requester. A smaller SQL diff, but a real RLS change to a table whose own header comment frames it carefully around a specific approval workflow — widening read access to "every guardian sees every other guardian's submitted reason text" is a real product decision (the `reason`/`denial_reason` free-text fields would become visible to guardians who didn't write them), not just a mechanical fix.

**Recommendation: (a).** It's a contained, additive change (one new read-only endpoint, scoped to "your own/your child's data," matching a self-service pattern this app doesn't have yet but easily could) versus a schema-level trust-boundary widening whose blast radius (other guardians seeing each other's submitted reasons) is a genuine privacy question the task's own "what not to do" list doesn't clearly authorize or forbid. The task's own list says "do not touch the guardian approval flow's write path" — (a) satisfies this by construction (a new read-only route touches nothing about how requests are submitted or approved); (b) is a read-side change and technically not forbidden by that exact wording, but is a materially bigger and more debatable change to sign off on than adding one endpoint.

---

## 1.4 Migration risk

| Site | LATE-rule change | Overlay-adoption change | Net direction |
|---|---|---|---|
| 1-9 (attendance rate, all) | None (already `PRESENT+LATE` everywhere) | Rate increases for any student/class/school with approved absences in the window (currently 0 of 9 apply it) | **Up, or unchanged if no approved absences exist in that window** — never down |
| Term average (3 sites) | N/A | Increases or decreases per-student, once unlinked `homework_completions`/`quiz_attempts` scores are unioned in — direction depends on whether a given student's unlinked scores are above or below their currently-visible (`grades`-only) average | **Direction not uniform** — the one place in this audit where "the number could go either way" is genuinely true, unlike attendance |

**PR-description framing recommendation**: lead with "attendance rates will rise for any student with an approved absence during the displayed window, and will not change for anyone else — this is a bug fix (approved absences were being silently counted as unapproved-equivalent before), not a rule change" rather than describing it as a LATE-handling fix, since the LATE part is a no-op everywhere it was checked.

---

## Recommendation: package location and helper architecture

**`packages/lib` does not exist** — confirmed via `packages/*/package.json` (only `config`, `db`, `types`, `ui`). The task's own instruction to "verify path against codebase conventions; adjust if the shared lib lives elsewhere" applies directly: **the established convention is `packages/types/src`**, which already hosts exactly this class of code (`grading.ts`'s `calculateSubjectAverage`/`assignLetterGrade`/`normalizeScore`) despite the package's name.

**The task's literal function signatures for two of the three helpers don't match this convention.** `getApprovedAbsences(studentId, dateRange, db)` and `calculateStudentTermAverage({studentId, termId, db})` both accept a live DB client and perform their own queries. Confirmed via a repo-wide grep for `SupabaseClient` across `packages/`: the only hit is a one-off Prisma seed script, not a runtime-shared module — **every existing export from `packages/types/src` is a pure, no-I/O function**; every caller fetches its own data (via `this.supabase.forUser()`/`.admin` in `apps/api`, or a server/browser Supabase client in `apps/web`) and passes plain data in. `packages/types/package.json` has zero Supabase dependency today (`zod` only), and zero test files exist inside the package itself — `grading.ts`'s tests live in `apps/api/src/__tests__/grading.spec.ts`, importing the package by name.

Given the RLS fork in §1.3 — where the *choice* of which Supabase client to query with is genuinely security-relevant, not incidental — baking that choice into a "types" package that's never made it before is a bigger architectural step than this PR needs to take.

**Recommendation**: split each of the three helpers into a **pure calculation core** (goes in `packages/types/src`, tested the same way `grading.ts` already is, via a new `apps/api/src/__tests__/*.spec.ts` file importing the package by name) plus a **thin per-app data-fetching wrapper** that owns the actual query and client choice:
- `calculateAttendanceRate` — already matches this shape as specified (`records`/`approvedAbsenceOverlay` arrays in, no `db` param) — goes into `packages/types/src` as-is.
- The approved-absence "get overlay data" step stays a per-app query (in `apps/api`, a proper (non-private) method on `AttendanceService`, generalized from `_approvedAbsenceStudentIds` to a date-range instead of single-date; for `apps/web`'s sites 5-8, the new endpoint from §1.3's recommendation) — not a `packages/types` function, since it must choose `admin` vs. `forUser()` correctly and that choice depends on which role is calling.
- `calculateStudentTermAverage`'s actual math (percentage-per-assessment, group-by-subject, mean-of-means) becomes a pure `packages/types` function taking already-fetched, already-deduplicated rows; the three-source fetch-and-reconcile step (`grades` + `homework_completions` + `quiz_attempts`, joined against `assessments.source_id`) is a per-app query function, most naturally a new method on an existing or new `apps/api` service (report-card generation already lives in `apps/web` server components today with no backend involvement — worth deciding in Phase 2 whether to centralize this behind a new API endpoint or keep it as a shared query function both apps import, matching how `calculateSubjectAverage` is imported today without an API round-trip).

This still achieves the task's core goal — "each rule decided once, tested once, called from everywhere" — for the actual *calculation* rules, which is where the duplication and disagreement risk actually lives (§1.1-1.2). The *fetching* mechanics were never actually duplicated in a way that caused a bug (each site's query is simple and correct for what it fetches); the bug was the calculation/completeness rules on top of correctly-fetched data.

## Dedup-join precision (the task's own wording is slightly imprecise)

`assessments.source_id` (B1-2b) points at `homework_assignments.id` or `quizzes.id` — **not** at a `homework_completions`/`quiz_attempts` row's own `id`. The correct dedup check for "is this homework_completions row already counted via `grades`": `EXISTS (SELECT 1 FROM assessments WHERE source_type='HOMEWORK' AND source_id = homework_completions.homework_id)`; symmetrically, `source_type='QUIZ' AND source_id = quiz_attempts.quiz_id`. Stating this precisely here so Phase 2 doesn't misimplement it as a literal id match.
