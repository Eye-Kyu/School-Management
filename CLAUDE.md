# CLAUDE.md

## 6. Database Conventions

**Bulk migration operations require per-file verification.** A single commit
adding or modifying more than 5 migrations must include, in its commit message
or PR description, explicit per-file evidence that each migration's schema
effect was verified live — not a blanket "all verified" assertion. The
migration parity check catches drift in single migrations but not in bulk
backfills where the drift and the check are introduced together (see BUG-5
for the case study that motivated this rule).
