## What changed

<!-- 1-3 sentences. What does this PR do? -->

## Why

<!-- Link to the EXECUTION_PLAN.md checkbox or issue this addresses. -->

## Stage / Release

<!-- e.g. v0.1 week 3, v0.2 notifications, etc -->

## Checklist

- [ ] Code follows the conventions in CLAUDE.md
- [ ] Unit tests cover the happy path + one edge case
- [ ] If this touches RLS: integration test attempts a cross-tenant access and asserts it fails
- [ ] If this mutates sensitive data: audit log entry is written
- [ ] If this adds a tenant-owned table: RLS is enabled in the same migration
- [ ] If schema changed: migration committed (and I will never edit it after merge)
- [ ] If a new env var was added: `.env.example` updated
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] Manually tested in the browser at smallest mobile viewport

## Notes for reviewer

<!-- Anything tricky, decisions you made, things you're unsure about. -->
