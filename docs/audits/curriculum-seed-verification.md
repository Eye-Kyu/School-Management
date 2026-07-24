# Curriculum Seed Verification

Audit trail for the Kenyan curriculum catalog data seeded into `curricula` / `curriculum_grade_levels` / `curriculum_subjects` / `curriculum_subject_strands`. This document is the honest record of what was verified against a public source, what was flagged for review, and what was deliberately left out. It is preserved as historical reference — not deleted after the PR merges.

**Seeding is purely informational.** Loading this catalog never touches any school's own `subjects`, `classes`, or `terms` records — confirmed by the existing `20260722000033_curriculum.sql` design and unchanged by this PR. Schools may optionally tag themselves against a catalog curriculum via the pre-existing `schools.curriculum_id` FK; nothing here does that automatically.

**Methodology note:** official KICD curriculum-design PDFs (`kicd.ac.ke/cbc-materials/curriculum-designs/`) could not be text-extracted with the tooling available for this pass — they render as binary/compressed content, not parseable text. Structural facts (grade names, subject lists) were confirmed either by fetching KICD's own HTML pages directly (e.g. the Grade Four Designs listing) or by cross-referencing multiple independent secondary sources. Strand-level detail, where included, comes from secondary educational sites that reproduce KICD strand/sub-strand headings — clearly noted per subject, and left empty rather than guessed wherever no reliable source was found.

---

## CBC (Competency-Based Curriculum)

**Sources consulted:**
- https://kicd.ac.ke/cbc-materials/curriculum-designs/ — official KICD curriculum design catalog (fetched directly)
- https://kicd.ac.ke/cbc-materials/curriculum-designs/regular-curriculum-designs/ — level index (fetched directly)
- https://kicd.ac.ke/cbc-materials/curriculum-designs/grade-four-designs/ — Grade 4 subject list (fetched directly, official primary source)
- Web search cross-references on: the 2024 Junior Secondary rationalisation (14→9 learning areas), Senior Secondary pathway structure, and Grade 4 Mathematics/Grade 7 Mathematics strand headings (secondary sources: cbcedukenya.com, various education-news outlets)

**Verified on:** 2026-07-24

**Subjects:** 46 total — 43 verified, 3 flagged for review.

| Level | Subjects | Verified | Flagged |
|---|---|---|---|
| Pre-Primary (PP1-PP2) | Language Activities, Mathematical Activities, Environmental Activities, Psychomotor and Creative Activities, Religious Education Activities | 5/5 | — |
| Lower Primary (Grade 1-3) | English, Kiswahili, Mathematics, Environmental Activities, Religious Education | included in cross-grade + level-specific rows above | — |
| Upper Primary (Grade 4-6) | Creative Arts, Social Studies, Science and Technology, Agriculture, CRE, IRE, HRE, Indigenous Language, Arabic, French, German, Mandarin | 11/13 | Physical and Health Education, Home Science ⚠️ |
| Junior Secondary (Grade 7-9) | English, Kiswahili, Mathematics, Integrated Science, Social Studies, Pre-Technical Studies, Agriculture and Nutrition, Creative Arts and Sports, Religious Education | 9/9 | — |
| Senior Secondary (Grade 10) | 4 compulsory + STEM/Social Sciences/Arts and Sports Science pathway electives (19 subjects) | 18/19 | Religious Education as a Social Sciences elective ⚠️ |
| Senior Secondary (Grade 11-12) | *(none populated — see Gaps)* | — | — |

**Flagged subjects (`verified: false` in the seed data):**
- **Physical and Health Education** (Upper Primary) — near-universally documented as a CBC subject elsewhere, but did not appear on the official KICD Grade Four page's category listing during this pass. May be integrated within Creative Arts at this level, or the fetched page excerpt may have been incomplete.
- **Home Science** (Upper Primary) — same situation as above.
- **Religious Education** (Senior Secondary, Social Sciences pathway elective) — appeared in only one of two cross-referenced secondary-source summaries of pathway electives.

---

## 8-4-4 System of Education

**Sources consulted:**
- https://en.wikipedia.org/wiki/8-4-4_Curriculum_in_Kenya (fetched directly)
- Web search cross-references on primary/secondary subject lists, KCPE/KCSE phase-out timeline (multiple Kenyan news outlets: Daily Nation, The Star, TRT Afrika)

**Verified on:** 2026-07-24

**Subjects:** 27 total — 26 verified, 1 flagged for review (Life Skills Education, inconsistently listed across sources as part of the primary curriculum).

**Grade-level activity status:** Standard 1-8 (primary) marked `is_active: false` — the final KCPE sitting was in 2023 and there has been no new Standard 1 intake under this system in years. Form 1-4 (secondary) marked `is_active: true` — genuinely still in use by phase-out cohorts, with the final KCSE sitting scheduled for 2027.

**Not included, deliberately:** technical/applied secondary subjects mentioned in some sources (Building Construction, Power Mechanics, Metalwork, Aviation, Woodwork, Electronics, Drawing and Design) — included in Wikipedia's category list but not in the task's own more conservative reference subject list; omitted rather than guessed at current availability. No KCPE/KCSE past-paper or assessment content included, per scope.

---

## Cambridge International Education

**Sources consulted:**
- https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-primary/ (fetched directly)
- https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-lower-secondary/ (fetched directly)
- https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-upper-secondary/cambridge-igcse/subjects/ (fetched directly, official subject codes)
- https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/cambridge-international-as-and-a-levels/subjects/ (fetched directly, official subject codes)

**Verified on:** 2026-07-24

**Subjects:** 54 total — 49 verified, 5 flagged for review (Primary Humanities and Modern Foreign Language — confirmed at Lower Secondary but not independently confirmed as distinct Primary-stage subjects; IGCSE History, Spanish, and Co-ordinated Sciences — plausible/well-known but not directly visible in the specific fetched page excerpts).

**Deliberately not exhaustive:** Cambridge IGCSE offers ~70 subjects (including ~30 languages) and A Level ~55 — only the commonly-offered subset is seeded here, matching the task's own instruction. A per-school extension mechanism for additional IGCSE/A-Level subjects is noted as a follow-up below, not built in this PR.

---

## Gaps

1. **CBC Grade 11 and Grade 12 have no subjects populated.** The first CBC cohort reached Grade 10 in January 2026; Grade 11 won't be reached until January 2027, Grade 12 until January 2028. Pathway structure is expected to continue, but no independently-confirmable subject list exists yet for these specific grades as of the seed date. The grade-level rows exist (marked `is_active: false`) for structural completeness, but subjects were deliberately left unpopulated rather than assumed to be identical to Grade 10.
2. **Senior Secondary pathway elective lists vary across secondary sources**, particularly for technical/applied STEM subjects (Aviation, Marine and Fisheries Technology, Building Construction, Metalwork, Power Mechanics, Wood Technology, Media Technology, Electricity appeared in one summarized source only). These were omitted entirely rather than included with a low-confidence flag, per "if in doubt, omit and note."
3. **The exact 4th compulsory Senior Secondary subject had a minor source discrepancy** — two independent sources list English/Kiswahili/Mathematics/Community Service Learning as compulsory; one listed Physical Education in place of Mathematics. The two-source majority (Mathematics) was used.
4. **Official KICD curriculum-design PDFs are not text-extractable with currently available tooling**, so strand-level detail is limited to what secondary sources reproduce. Only Grade 4 and Grade 7 Mathematics strands were verified in this pass; every other subject-grade combination's `strands_per_grade` is intentionally empty.
5. **CBC Lower Primary's exact "7 core learning areas"** are inferred from a secondary source's summary figure rather than a directly fetched official per-grade subject list (unlike Upper Primary, where Grade 4's list was fetched directly from KICD).

## Follow-ups

- **Kenyan curriculum specialist review requested** before this data is relied on for anything student-facing (report card generation with curriculum-aware assessment mapping, curriculum-based subject recommendations, etc.) — this seed is a reasonable-effort, publicly-sourced starting catalog, not a substitute for domain expert sign-off.
- **Per-school subject extension mechanism** for Cambridge IGCSE/A-Level (and potentially CBC electives) — schools using this catalog may want to offer subjects beyond the commonly-offered set seeded here. Not built in this PR.
- **IB, Montessori, American, and Madrasa curriculums** — explicitly out of scope for this PR, noted as follow-up catalog additions.
- **`setCurriculumSubjects` (the existing "Save subjects" bulk editor) does a hard delete-then-reinsert of every subject row for a curriculum on save.** If a SuperAdmin uses that editor on a seeded curriculum, any strands linked to the old subject-row UUIDs will be orphaned/cascade-deleted, since new rows get fresh UUIDs. This PR does not change that editor's behavior (matches the "do not redesign the page" instruction) — a follow-up should either make `setCurriculumSubjects` strand-preserving or add a UI warning before this catalog sees heavy manual editing.
