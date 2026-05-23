# Web-only validators

Most Zod schemas live in `@school-manager/types` because they're shared with
the API. This folder is for validators that are genuinely web-only - things
like client-side form rules that don't have an API counterpart.

If you're tempted to put a schema here, ask: "does the API also need this?"
If yes, it goes in `@school-manager/types` instead.
