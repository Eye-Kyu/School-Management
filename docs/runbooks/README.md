# Runbooks

Operational procedures. The "what do I do when X breaks?" pages.

Each runbook should be readable at 3am by someone tired. That means:
- Numbered steps.
- Exact commands, not "run pg_dump" but the full command line.
- A clearly stated outcome at each step ("you should see X").
- A "if this fails" branch for each step that can fail.

## When to write one

Any operation that:
- Is rare enough that you'll forget the steps.
- Has consequences if done wrong (data loss, downtime, security).
- More than one person might need to perform.

## Index

- [incident-response.md](./incident-response.md) - P0/P1 incident handling
- [onboard-a-school.md](./onboard-a-school.md) - new school setup
- [restore-from-backup.md](./restore-from-backup.md) - DB restore drill
- [rotate-secrets.md](./rotate-secrets.md) - planned and emergency rotations
