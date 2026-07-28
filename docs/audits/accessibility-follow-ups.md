# Accessibility follow-ups (Phase 0, sub-sprint 4)

**What this document is.** The 15-page WCAG 2.1 AA sweep this sub-sprint ran fixed every concretely-identifiable, static-analysis-findable issue on the named pages (icon-button labels, form-label/control associations, the gradebook score grid and attendance status grid having no accessible names, the app's two overlay modals having no dialog semantics, and a scoped color-contrast pass). This document is the honest record of what that sweep could **not** cover and why, plus everything deliberately deferred.

## A hard capability gap, stated plainly

**This environment has no browser or accessibility-testing tool available.** No Playwright/browser-automation MCP, no way to actually launch a browser, run axe DevTools against a rendered page, or operate a screen reader (VoiceOver/NVDA). Every fix in this sub-sprint was made by reading JSX and reasoning about the DOM it produces — not by observing a real rendered page or a real axe report. This matches every prior sub-sprint's documented limitation in this codebase.

**Concretely, this sub-sprint could NOT do:**
- Run axe DevTools (or `@axe-core/playwright`) against any of the 15 pages and confirm zero critical/serious violations — the DoD's literal bar.
- A VoiceOver (macOS) or NVDA (Windows) manual pass on the sign-in flow, mark-attendance flow, or pay-fees flow, as the original task requested.
- Verify keyboard-only navigation actually works end-to-end (tab order, focus visibility) beyond what's inferable from JSX structure.
- Measure real, rendered color contrast (the fixes below are based on Tailwind's known hex values calculated by hand, not a measured/rendered check).

**What was done instead, as the closest realistic proxy:**
- `eslint-plugin-jsx-a11y`'s full recommended ruleset is now explicitly enabled (`packages/config/eslint/nextjs.js`), at `warn` severity so it doesn't fail CI on the ~130 files outside this sweep's scope. This is static analysis, not a real DOM/contrast/screen-reader check — it catches missing labels and some ARIA misuse, nothing else.
- Every concrete issue jsx-a11y could statically find on the 15 pages was fixed (see "What was fixed" below).

**Action needed from the project owner (or a future session with real browser tooling):** run an actual axe DevTools pass and a screen-reader pass on the 15 pages before treating this sub-sprint's accessibility work as verified, not just "as good as static analysis can tell."

## What was fixed (the 15 pages + 2 closest-equivalents, per the sub-sprint 4 plan)

- Icon-only buttons (✕/× dismiss/remove buttons) — added `aria-label`.
- Every form `<label>`/`<input>`/`<select>`/`<textarea>` pair — added `htmlFor`/`id` association, plus a redundant `aria-label` on controls where `jsx-a11y/control-has-associated-label` doesn't recognize an `htmlFor`/`id` pair alone (a known quirk of that specific rule — it checks for nesting or a direct `aria-label`/`aria-labelledby`, not a file-wide `id` cross-reference).
- The gradebook's per-student × per-assessment score-entry grid and the attendance page's per-student × status radio grid — every cell now has a real accessible name (`aria-label`) combining student name + assessment/status; attendance status `<th>`s gained `scope="col"`.
- Two labels that were semantically mislabeling a caption (not one specific control) as a `<label>` — changed to `<span>` (`AttendanceClient.tsx`'s "Class Prefect" and "Class reports" captions).
- The one decorative, non-interactive checkbox (`TodaysChecklist.tsx`'s `ChecklistRow`, mirroring a link's own strikethrough state) — marked `aria-hidden`/`tabIndex={-1}` so it's not a confusing, un-interactive stop in the tab order.
- Both real overlay modals in the app (`PaybillDashboard.tsx`'s `MatchModal` and the overpayment-resolution modal — not one of the 15 pages, but the only genuine modals anywhere and a cheap, high-value fix) — added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape-to-close, initial focus into the dialog, and focus-return to the triggering element on close.
- Error-message containers on the touched pages — added `role="alert"` where a plain `<p>` previously carried an error with no announcement.
- Color contrast: `text-slate-400` (`#94a3b8` on white ≈ 2.9:1, fails WCAG AA's 4.5:1 for normal text) swapped to `text-slate-500` (≈ 4.6:1, passes) — scoped to the 15 target pages' own files only, not a repo-wide sweep, to avoid the "adjusting backgrounds instead of text, causing design drift" risk the original task warned against.

## Deferred — needs a design decision, not just a code fix

- **Repo-wide color contrast.** `text-slate-400` appears ~445 times across the whole app (only ~90 of those, within the 15 target pages, were fixed here); `text-slate-500` itself is only borderline-passing (≈4.6:1, just above the 4.5:1 AA line) and `text-slate-300` (≈1.9:1, 15 occurrences repo-wide) is a clear failure wherever it's used for real text. A proper fix needs a real design pass (the codebase has no design-token system yet — `tailwind.config.ts`'s own comment says *"Theme tokens go here once a designer is involved"*), not a mechanical find-replace. **Axe severity if measured: likely serious**, given the volume.
- **`PaybillDashboard.tsx`'s modal backdrops** (`<div onClick={onClose}>` for click-outside-to-dismiss) trip `jsx-a11y/click-events-have-key-events` / `no-static-element-interactions` — a non-interactive `<div>` has a click handler with no keyboard equivalent. Not fixed here because the correct fix (making the backdrop a proper button/focusable region, or removing click-outside-dismiss in favor of only the Cancel button + the Escape key this sub-sprint already added) is a small design decision, not purely mechanical. **Axe severity if measured: moderate** — Escape already provides a keyboard path to close, this is about the backdrop specifically being inert to keyboard/AT users, which is expected (backdrops aren't meant to be focusable).
- **`PaybillDashboard.tsx`'s `UnifiedFeed` filter form** (student/date/source selects, not part of the two modals) still has unassociated labels — not one of the 15 pages, not touched. Same pattern as the fixes above would apply.

## Deferred — explicitly out of scope per the task's own instruction

- Anything requiring a redesign (the contrast items above, if a broader palette change is the eventual fix rather than per-instance color swaps).
- Complex ARIA patterns: none of the 15 pages use custom dropdowns, tree views, or tab systems, so none were encountered — noted for completeness, not because one was found and skipped.
- Reordering navigation or changing muscle-memory UI flows for accessibility reasons alone — not attempted anywhere.

## Two pages named in the task without a matching real route

- "Teacher: a class detail page" — no such route exists (confirmed via full directory search). Closest real equivalent swept instead: `teacher/assignments/[id]/page.tsx` + `SubmissionsClient.tsx` (a class roster + submissions view).
- "Parent: a child-summary page" — no dedicated route exists. Closest real equivalent swept instead: `parent/attendance/page.tsx` (a per-child attendance summary).

## One accepted non-issue

`GradebookClient.tsx` has one remaining `jsx-a11y/control-has-associated-label` warning on an empty `<td />` (a footer-row spacer cell under the "Avg" column, which the table doesn't compute a value for). This is a false positive of that rule on an empty table cell with no control or content — left as a `warn`-level, non-blocking warning rather than adding meaningless markup to silence it.
