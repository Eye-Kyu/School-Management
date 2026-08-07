# Documents Current-State Audit

**Scope:** Bucket 1, PR 3, Phase 1 — audit the current documents/file-upload subsystem to determine the right implementation path for scope-tagging (class/subject/assignment) and in-context surfacing, before any implementation begins.

**Status:** Phase 1 (audit) complete. **No code changes in this PR.** Awaiting explicit review/go-ahead before Phase 2 implementation starts, per the task's own instruction.

## Summary

| Area | Finding |
|---|---|
| Documents backend | **A working feature already exists** — `public.documents` (real table, real RLS, real Storage bucket) — this is not greenfield |
| Existing scope mechanism | `audience` (`SCHOOL_WIDE`/`GRADE`/`CLASS`) + `target_grade_level`/`target_class_id` — already present, but a **different shape** than the new `scope_type`/`scope_id` spec (no `SUBJECT`, no `ASSIGNMENT`; has `GRADE`, which the new spec doesn't) |
| Is the existing scope mechanism enforced? | **No.** RLS only checks `school_id` + module enablement — `audience`/`target_class_id` are stored but never read by any policy. Any authenticated user at the school can see every document today regardless of declared audience |
| NestJS backend | **None exists.** 100% direct browser-to-Supabase (Storage + table), same shape as quizzes were before B1-2a |
| Existing UI | **Admin-only.** No teacher/student/parent page or nav entry exists anywhere in the app |
| Download access control | **None.** Public bucket, public URL, `<a href>` — no signed URL, no per-user check, no audit log. Anyone with the URL can download, authenticated or not |
| Storage-object RLS vs. table RLS | **Mismatched.** Any `authenticated` user (any role) can write/overwrite/delete bucket objects directly via the Storage API, even though the table itself restricts row INSERT/UPDATE/DELETE to `ADMIN`/`TEACHER` |
| Assignment-like entities for `scope_type='ASSIGNMENT'` | **Three, not one** — `homework_assignments`, `quizzes`, `assignments`+`submissions` — none has a teacher-attaches-reference-document concept today, and their ownership columns aren't even the same shape across the three |
| Subject/class pages to surface documents on | **Do not exist for any role.** Only admin has flat CRUD list pages for subjects/classes; there is no per-subject or per-class detail page anywhere in the app to add a "Documents" section to |
| Live production data | **Zero rows** in `documents` and `document_chunks` — any migration here is risk-free from a data standpoint |
| Correction to a prior audit | B1-2a's own audit (`docs/audits/homework-quiz-gradebook-relationship.md:56`) claimed `assignments`/`submissions` was "orphaned schema... not currently reachable by any user action." **This was already wrong when it was written** — the frontend for it (`apps/web/app/(dashboard)/teacher/assignments/`, `.../student/assignments/`) was added 2026-05-28, over two months before that audit (2026-08-03). It is live, working code, not a stub |
| Recommendation | **Approach A, with one subtractive step + two explicit open questions for the reviewer** — see §1.7 |

---

## 1.1 What tables back documents today

Grepped the whole repo for `documents`, `document_library`, `attachments`, `files`, `uploads` (migrations + Prisma schema). Two live tables, one Storage bucket, one unrelated adjacent table.

### `public.documents` — the main table

Created in `supabase/migrations/20260527000014_quizzes.sql:101-116` (the "Week 17" migration file — the table itself predates and is unrelated to quizzes; it was just bundled into the same file). **Never altered since** — confirmed via a repo-wide grep for `ALTER TABLE public.documents`, zero hits beyond the RLS policy re-issue in `20260721000024_module_enforcement_rls.sql` (policies only, no column changes).

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `school_id` | UUID | NOT NULL, FK → `schools(id)` CASCADE |
| `uploaded_by_id` | UUID | NOT NULL, FK → `users(id)` CASCADE |
| `title` | TEXT | NOT NULL |
| `file_url` | TEXT | NOT NULL — a public Storage URL, see §1.3 |
| `file_name` | TEXT | NOT NULL |
| `file_size` | BIGINT | nullable |
| `mime_type` | TEXT | nullable |
| `audience` | TEXT | NOT NULL, default `'SCHOOL_WIDE'`, CHECK IN (`SCHOOL_WIDE`, `GRADE`, `CLASS`) |
| `target_grade_level` | INT | nullable — populated only when `audience = 'GRADE'` |
| `target_class_id` | UUID | FK → `classes(id)` SET NULL — populated only when `audience = 'CLASS'` |
| `tags` | TEXT[] | NOT NULL, default `{}` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |

**No `deleted_at` column.** Index: `documents_school_idx ON (school_id, created_at DESC)` (`:118`).

**This is already a scope-tagging mechanism** — `audience` + `target_grade_level`/`target_class_id` — just not the same shape as the task's proposed `scope_type`/`scope_id`:
- Has `GRADE` (a whole grade level, e.g. "all of Grade 5"), which the new spec has no equivalent for.
- Has no `SUBJECT` or `ASSIGNMENT` scope at all.
- Uses two separate nullable columns (`target_grade_level` OR `target_class_id`) rather than one generic `scope_id`.

This is a real design fork Phase 2 has to resolve explicitly (see §1.7), not an incidental detail.

### `public.document_chunks` — AI tutor RAG chunking (adjacent, not the same feature)

Created in `supabase/migrations/20260602000020_document_chunks.sql:2-9`:

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `school_id` | UUID | NOT NULL, FK → `schools(id)` CASCADE |
| `document_id` | UUID | NOT NULL, FK → `documents(id)` **ON DELETE CASCADE** |
| `chunk_index` | INT | NOT NULL |
| `content` | TEXT | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |

A GIN full-text index exists on `content` (`20260602000021_document_chunks_fts_index.sql`, `to_tsvector('english', content)`), but this powers the **AI tutor's retrieval**, not any user-facing document search — it's on chunked body text, not document titles/metadata, and there's no UI anywhere that queries it directly. Relevant precedent for FTS technique, not a reusable feature for this PR's Task 5 (which the task explicitly scopes to title-only, no-infra search).

**Implication of the `ON DELETE CASCADE`:** today, hard-deleting a `documents` row cascades and removes its chunks automatically. If Phase 2 adds soft delete (`deleted_at`), that cascade stops applying — chunks for a soft-deleted document will persist and remain queryable by the AI tutor unless Phase 2 explicitly handles that case. Flagging, not fixing, per this audit's no-code-changes scope.

One more adjacent, unrelated table: `public.tutor_logs.documents_used TEXT[]` (`20260602000022_tutor_logs.sql:10`) — a plain array of document titles/ids used in one AI tutor session log. Not a join table, not in scope for this feature, listed here only so it isn't mistaken for something relevant.

### Prisma

`packages/db/prisma/schema.prisma` has **no `Document` (or similar) model at all** — grepped for `model Document`, zero hits. Consistent with every other finding across B1-2a/2b: Prisma in this codebase is a type-generation-only layer that's fallen behind the live schema in several places (the `Grade`/`Score` discrepancy B1-2b found is the same category of gap). Not a blocker — no `apps/api/src` code calls `prisma.<model>.` for anything, confirmed repeatedly in prior audits — but Phase 2 will need to add the model from scratch, not "update" one.

### Live population check (read-only, 2026-08-04)

Direct REST probe against production (`GET .../rest/v1/documents?select=id` with `Prefer: count=exact`, `Range: 0-0`):

```
documents:       Content-Range: */0   (0 rows)
document_chunks: Content-Range: */0   (0 rows)
```

**Zero rows in both tables in production.** No existing data is tagged (or taggable) today — not because retrofitting hasn't happened, but because nothing has ever been uploaded through this feature in production. This matches B1-2a's own "zero existing rows" finding for `assessments`/`homework_completions` and carries the same implication: any schema change here is risk-free from a migration-safety standpoint, regardless of which design is chosen.

### RLS policies — table level

Current, live policy text (from `20260721000024_module_enforcement_rls.sql:14-46`, which superseded the original policies in `20260527000014_quizzes.sql:120-130` by adding the module-enablement check — confirmed no later migration touches these):

```sql
CREATE POLICY "docs_select" ON public.documents FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'document_library')
);
CREATE POLICY "docs_insert" ON public.documents FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER')
  AND module_enabled(school_id, 'document_library')
);
CREATE POLICY "docs_update" ON public.documents FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER')
  AND module_enabled(school_id, 'document_library')
);
CREATE POLICY "docs_delete" ON public.documents FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER')
  AND module_enabled(school_id, 'document_library')
);
-- document_chunks: same shape, chunks_select/insert/delete (no chunks_update — chunks are write-once, replace-via-delete-and-reinsert)
```

**`audience`/`target_grade_level`/`target_class_id` are not referenced anywhere in these policies.** Any authenticated user at the school — student, parent, teacher, admin — can currently `SELECT` every document at their school regardless of its declared audience. The scope columns are purely advisory metadata today, filtered (if at all) only by the one UI that reads them (admin's own list, which doesn't even filter by audience — see §1.4).

### RLS policies — Storage-object level (a second, separate policy surface, and it's more permissive than the table)

From `supabase/migrations/20260527000015_documents_bucket.sql`:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "documents_read" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "documents_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
CREATE POLICY "documents_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "documents_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents');
```

Two distinct gaps here, confirmed live (bucket fetched via the Storage Admin API, 2026-08-04: `{"public":true,"file_size_limit":null,"allowed_mime_types":null,...}`):

1. **`documents_read` has no role restriction and the bucket is `public: true`.** Combined, this means anyone who knows or guesses a file's storage path — authenticated or not, any school or none — can download it directly from Supabase Storage, completely bypassing the `documents` table's own RLS. The table's `school_id`/`module_enabled` scoping is meaningless for the actual file bytes.
2. **`documents_insert`/`update`/`delete` are `TO authenticated` with no role check at all** (`bucket_id = 'documents'` is the only condition) — any authenticated user, including a STUDENT or PARENT, can write, overwrite, or delete objects in this bucket directly via the Storage API, even though the `documents` table itself restricts row-level writes to `ADMIN`/`TEACHER`. The row-level and object-level policies disagree with each other.

Neither gap is new to this PR and neither is fixed here (audit-only scope) — flagged because any Phase 2 that adds access-controlled (non-`SCHOOL_WIDE`) scopes has to reckon with the fact that the file bytes themselves are not currently access-controlled at all, only the metadata row is (weakly). A `scope_type='CLASS'` document's *row* could be made properly RLS-scoped in Phase 2, while its *file* remains downloadable by anyone with the URL — that gap would persist across scope types unless Phase 2 also addresses storage-object policy, which is a materially larger change than the task's spec assumes (would need per-object or per-path RLS, or a move to signed URLs + a private bucket — neither has any precedent in this codebase yet, confirmed via a repo-wide grep for `createSignedUrl`, zero hits).

---

## 1.2 Upload flow

**Single origin, admin-only:** `apps/web/app/(dashboard)/admin/documents/page.tsx` is the only upload UI anywhere in the app — confirmed via a repo-wide grep for `documents`/`library`/`upload`/`attachment` across `apps/web`, and via glob for any `documents`/`library` route under any role's dashboard tree (only `admin/documents` exists).

**File bytes go directly from the browser to Supabase Storage — no backend involved:**

```ts
// admin/documents/page.tsx:64-71
const { data: userRow } = await supabase.from('users').select('id, school_id').maybeSingle();
const path = `documents/${userRow?.school_id}/${Date.now()}_${file.name}`;
const { error: uploadErr } = await supabase.storage
  .from('documents').upload(path, file, { upsert: false, contentType: file.type });
const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(path);
```

**No NestJS backend endpoint for documents exists at all** — confirmed via `Glob("apps/api/src/**/*document*")`, zero matches. Same architecture quizzes had before B1-2a (100% client-side Supabase, RLS-enforced, no server-side validation layer) — except quizzes at least had a real feature surface across roles; documents has that gap *and* is single-role.

**Metadata captured today** (`admin/documents/page.tsx:73-85`, inserted into `documents` immediately after the Storage upload succeeds): `title`, `audience`, `target_grade_level` (conditionally), `target_class_id` (conditionally), `tags` (comma-separated string, split client-side), `file_name`, `file_size`, `mime_type`. No description field, no expiry, no visibility-beyond-audience field.

**One existing backend touchpoint, unrelated to upload itself:** after the DB insert succeeds, the page fires `apiFetch('/ai/process-document', { method: 'POST', body: { documentId } })` fire-and-forget (`:92-95`) — this is the AI tutor's chunking pipeline (writes to `document_chunks`), not part of the upload/scoping flow, and out of scope for this feature.

---

## 1.3 Download and access flow

**Plain public URL, no proxy, no signed URL, no access check:**

```ts
// admin/documents/page.tsx:201-202
<a href={d.file_url} target="_blank" rel="noopener noreferrer" ...>{d.title}</a>
```

`d.file_url` is the `getPublicUrl()` result captured at upload time and stored verbatim in the `documents.file_url` column. Opening it is a direct request to Supabase Storage's public CDN — no app code, no RLS check (Storage's own `documents_read` policy applies, and per §1.1 that policy imposes no restriction beyond the bucket id), no session requirement.

**Access control on downloads today: effectively none.** Whatever the row's `audience` claims, or which `school_id` it belongs to, is irrelevant to who can actually fetch the bytes — only knowledge of the URL matters, and the URL path (`documents/{school_id}/{timestamp}_{filename}`) is not a secret (it's derivable, and would be directly visible in the `documents` table's `file_url` column to any authenticated user at the school per the table RLS in §1.1).

**Downloads are not audit-logged.** No `audit_logs` insert exists anywhere in the download path — there is no download path, in the sense of app-mediated access; it's a raw hyperlink to a CDN URL.

---

## 1.4 Existing library UI

| Role | Nav entry | Page | Capabilities |
|---|---|---|---|
| Admin | Yes — `DashboardShell.tsx:29`, `{ href: '/admin/documents', label: 'Documents', moduleKey: 'document_library' }` | `admin/documents/page.tsx` | Upload (with audience picker), delete (hard delete, `confirm()` only), client-side title/tag search |
| Teacher | **None** | **None** | Nothing — cannot even view the library, despite RLS allowing `TEACHER` role to `INSERT`/`UPDATE`/`DELETE` rows (the RLS grant exists; no UI ever exercises it) |
| Student | **None** | **None** | Nothing |
| Parent | **None** | **None** | Nothing |

Confirmed via `Glob("apps/web/app/(dashboard)/**/{documents,library}/**")` → one match (`admin/documents/page.tsx`), and via grep across `apps/web` for `documents`/`Document Library` → the only other hits are `DashboardShell.tsx` (the nav array above) and one unrelated hit in `lib/supabase/server.ts` (a generic Supabase client type, not documents-related), plus a super-admin `privileged-access` page that references "documents" only in unrelated grant-audit copy text.

**This directly affects the task's framing.** The spec describes the standalone library as something that "becomes the school-wide section" once tagging ships — but there is currently no library for any role except admin to convert. Teachers, students, and parents aren't losing a feature to the new scoped views; they're getting document visibility (school-wide, at minimum) for the first time. Phase 2 needs to build the read-only school-wide view for teacher/student/parent roles as new surface area, not a migration of existing UI.

**Existing search:** client-side only, title/tag substring match (`admin/documents/page.tsx:106-109`), no scope filter, no uploader filter, no date range, and state lives in a plain `useState`, **not** URL query params — the new spec's Task 5 filter set (scope/uploader/date-range, URL-persisted) is new work, not an extension of an existing filter bar.

---

## 1.5 Assignment attachment path

**Three separate "assignment-like" entities exist in this codebase, and none of them has a teacher-attaches-reference-document concept today.** This is the single most consequential finding for Phase 2 scoping (see §1.7).

### 1. `homework_assignments` (physical/in-person homework)

`supabase/migrations/20260526000008_events_homework.sql:26-37`. Owner column: `teacher_id UUID NOT NULL REFERENCES teachers(id)`. B1-2a added grading (`score`/`grader_note`/`graded_at`/`graded_by_user_id` on `homework_completions`, `max_score` on `homework_assignments`); B1-2b added gradebook linking. **No file/attachment column of any kind, then or now.**

### 2. `quizzes` (in-app MCQ/short-answer)

`supabase/migrations/20260527000014_quizzes.sql:5-18`. Owner column: `created_by_id UUID NOT NULL REFERENCES users(id)` — **a different table than homework's owner column** (`users.id` vs. `teachers.id`; B1-2b's `QuizzesService` had to build a parallel authorization branch for exactly this reason, see its own code comments). No file/attachment column.

### 3. `assignments` + `submissions` ("online assignments" — teacher-created, student-submitted)

`supabase/migrations/20260527000012_gradebook.sql:6-36`. Owner column on `assignments`: `created_by_id UUID NOT NULL REFERENCES users(id)` (same shape as quizzes, different from homework). `submissions.file_urls TEXT[]` **does** carry file references — but these are **student-submitted work**, gated by `assignments.allowed_types` (what a student is permitted to upload), the opposite direction from a teacher attaching reference material for students to read.

**Correction to a prior audit, verified via git history, not assumption:** B1-2a's own Phase 1 audit (`docs/audits/homework-quiz-gradebook-relationship.md:56`) states: *"A separate, unrelated, currently-dead table pair also exists... `public.assignments`/`public.submissions`... No NestJS controller and no frontend page anywhere queries either table... orphaned schema... not currently reachable by any user action."* This is incorrect, and was already incorrect at the time it was written:

```
$ git log --diff-filter=A --format="%ai %H %s" -- \
    "apps/web/app/(dashboard)/teacher/assignments/AssignmentsTeacherClient.tsx"
2026-05-28 13:55:30 +0300  77bd0e7  Student Analytics and Quizzes added
```

The frontend for `assignments`/`submissions` (`apps/web/app/(dashboard)/teacher/assignments/` — list, detail, and submissions-review pages; `apps/web/app/(dashboard)/student/assignments/` — list and submit pages) was committed **2026-05-28**, over two months before the B1-2a audit was written (2026-08-03). It is live, working code — teachers create assignments and review submissions at `/teacher/assignments`, students submit at `/student/assignments` — not a stub, and not orphaned. B1-2a's own implementation work never touched this table pair (it correctly stayed within `homework_assignments`/`homework_completions`), so this error didn't propagate into any shipped code — but it means **any future audit or plan that cites `assignments`/`submissions` as dead should re-verify rather than trust that prior claim.** Flagging here per BUG-5 discipline (verify against live state, not a document's own prior claims) — not filing to `docs/bug-triage.md`, since no code shipped on the wrong premise; noting it here is the correction.

### The open question this creates for Phase 2

None of the three entities has any existing precedent for "a teacher attaches a reference document." The task's own phrasing — *"Assignment: dropdown of the uploader's assignments (homework, quizzes, whatever assignment-like entities the audit found)"* — reads as delegating this resolution to Phase 1, the same way B1-2b's `assessments.source_type` distinguished `HOMEWORK`/`QUIZ` as two kinds of one concept rather than picking one. Two real options, not resolved by this audit (a product-scope call, not an evidence-derivable one):

- **(a)** `scope_type='ASSIGNMENT'` validates against all three tables (a `scope_id` that must resolve to a row in `homework_assignments` OR `quizzes` OR `assignments` the uploader owns) — mirrors B1-2b's `source_type` pattern, but means "ASSIGNMENT" is itself polymorphic underneath one `scope_type` value, which `scope_id` alone can't disambiguate without also knowing which table matched (Phase 2 would need to resolve this the same way `AssessmentsService.upsertScores()` resolves a linked source — try each table in a defined order, or store a sub-discriminator).
- **(b)** Pick one canonical "assignment" entity. If only one, `assignments` is the literal name match and already has file-handling precedent (`allowed_types`) — but `homework_assignments` is the more actively-developed entity (two prior PRs' worth of investment) and quizzes are the most interactive. Picking one excludes attaching documents to the other two entirely.

This audit recommends **(a)**, three-way validation, matching the codebase's own established precedent for exactly this ambiguity rather than a Phase 2-specific compromise — but flags it explicitly as a call the reviewer should confirm before Phase 2 starts, not something to build on silent assumption.

---

## 1.6 Storage estimation

| Metric | Value | Method |
|---|---|---|
| `documents` rows | **0** | Live REST probe, `Prefer: count=exact`, 2026-08-04 |
| `document_chunks` rows | **0** | Live REST probe, `Prefer: count=exact`, 2026-08-04 |
| Storage bucket config | `public: true`, `file_size_limit: null`, `allowed_mime_types: null` | Live Storage Admin API probe, 2026-08-04 |
| Total storage used | **Not separately measured** — with zero `documents` rows and no orphan-upload path in the current UI (the DB insert happens synchronously after the Storage upload, in the same handler, with no partial-failure retry), there should be no orphaned objects in the bucket either. A full `storage.objects` listing for the `documents` bucket was not run (would require pagination against the Storage API); given the zero-row DB state this is very unlikely to change the picture and wasn't pursued further |
| Upload rate | **Cannot be estimated — no historical data exists.** The feature is effectively unlaunched in production |

**Conclusion:** there is no meaningful storage-cost or migration-performance consideration for this PR. Whatever schema/scope design Phase 2 lands on, it will start from zero real-world data.

---

## 1.7 Recommendation

**Approach A (additive columns), with one deliberate subtractive step, plus two explicit open questions the reviewer should confirm before Phase 2 starts.**

This is not a default — it's a conclusion from the specific overlap found in §1.1. A pure, unqualified Approach A (add `scope_type`/`scope_id`, leave everything else alone) would leave `audience`/`target_grade_level`/`target_class_id` sitting alongside the new columns, unused by any RLS policy (already true today) and unused by any new code — two scope systems on one table, one live and one dead weight, which is exactly the "scattered" state Approach B exists to prevent. A pure Approach B (full subsystem refactor) is not justified by what was actually found: the upload/Storage/table wiring **works** today, it's just thin (single role, no backend, weak access control) — those are gaps to close within the existing shape, not evidence the shape itself needs replacing.

**What this recommends, concretely:**
1. Add `scope_type`/`scope_id` exactly as specified in the task (nullable `scope_id`, `CHECK` constraint, partial index) — zero data risk per §1.6, and it directly matches the precedent B1-2b already established on `assessments.source_type`/`source_id`, which is a real strength (one more team member familiar with the pattern, one fewer new idiom to learn).
2. **Drop `audience`, `target_grade_level`, `target_class_id` in the same migration.** Zero live rows (§1.1) means there is no data-migration cost to removing them — this is the one subtractive step, and it's what keeps this "Approach A" rather than "Approach A plus permanent scope-system duplication." `GRADE`-level audience (a whole grade, spanning multiple classes) has no equivalent in the new `scope_type` enum; if that granularity is wanted, it should be a deliberate Phase 2 design decision (e.g. widen `SUBJECT`-like semantics, or accept the narrowing), not something quietly lost by column removal without comment.
3. **Phase 2 needs to explicitly resolve, not inherit by assumption:**
   - **Which assignment-like entity (or entities) `scope_type='ASSIGNMENT'` targets** — §1.5's recommendation is three-way validation, but this is a product-scope call for the reviewer, not an audit-derived certainty.
   - **Whether Task 4 ("surface documents in context") includes building subject and class detail pages for the first time.** They don't exist for any role today (§1.4/§1.6's sibling finding — no `Glob` match for any `{subjects,classes}/[id]` route anywhere in `apps/web`). Adding a "Documents" section *to* a subject/class page is a small, contained change; *building* subject/class detail pages from scratch (routing, data-fetching, layout, and everything else those pages would eventually need beyond documents) is materially larger scope than this task's own text implies it is. This audit does not resolve which is intended — it flags that the task's premise doesn't match the current codebase and needs an explicit call before Task 4 is estimated or built.

**What this recommendation minimizes:** migration risk (zero rows, so both the additive and subtractive parts are safe), design debt (one scope system, not two), and the risk of Phase 2 silently making a three-way-ambiguous or page-doesn't-exist assumption that then has to be unwound later — the same failure mode B1-2b's own audit process was built to catch.

**What it costs:** the subtractive step means the existing admin upload form's `audience`/grade-level/class-target UI has to be rebuilt against the new columns rather than left alone (it would need rebuilding anyway, to add `SUBJECT`/`ASSIGNMENT` options — this isn't additional cost beyond what Task 2 already requires). The two open questions mean Phase 2 cannot start purely from this task's spec text — it needs the reviewer's explicit answer to both before implementation, which is exactly why this audit stops here rather than proceeding on assumption.

**Migration path:** one migration, in the same file or immediately adjacent to the one adding `scope_type`/`scope_id` — `ALTER TABLE documents DROP COLUMN audience, DROP COLUMN target_grade_level, DROP COLUMN target_class_id` (safe, zero rows) alongside the additive `ADD COLUMN scope_type ...`/`ADD COLUMN scope_id ...`/`CREATE INDEX ...` from the task's own Task 1 spec. `deleted_at` (Task 6) and `document_downloads` (Task 7) are independent additive changes with no interaction with this one.
