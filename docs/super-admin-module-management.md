# SuperAdmin: managing school modules

## What SUPER_ADMIN can and can't do

`SUPER_ADMIN` is a platform-level role, separate from the tenant-scoped
`ADMIN`/`TEACHER`/`STUDENT`/`PARENT` roles. It has no home school. By design,
it is restricted to **platform management only**:

- View the list of registered schools.
- View and toggle which features (modules) are enabled for a given school.

It **cannot** view student records, grades, attendance, messages, or any
other tenant data belonging to any school — that boundary is enforced by the
same Row-Level Security that isolates School A from School B, not by
anything specific to this role. A compromised SuperAdmin account can
misconfigure feature toggles; it cannot read your students' data.

## Creating the first SuperAdmin account

There's no self-service signup for this role — create it manually in the
Supabase dashboard:

1. **Authentication → Users → Add user.** Set email/password, confirm email.
2. Edit the new user's **raw user metadata** (or set it at creation time) to:
   ```json
   { "role": "SUPER_ADMIN" }
   ```
   Note: no `school_id` key — SuperAdmins don't have one.
3. Log in at `/login` with these credentials — you'll land on `/super-admin`
   instead of a tenant dashboard.

## Managing a school's modules

1. Go to `/super-admin` — lists every registered school.
2. Click a school to open its module list, grouped by category.
3. Each row shows: name, description, current status (Enabled/Disabled),
   whether it's Core (can never be disabled), Coming Soon, and any
   dependencies it requires.
4. Click **Enable**/**Disable** — you'll get a confirmation prompt, then:
   - If you're **enabling** something whose dependency isn't enabled yet,
     you'll get a clear error naming the missing dependency instead of the
     toggle silently failing.
   - If you're **disabling** something other enabled modules depend on,
     you'll see a warning listing what will stop working — the disable
     still goes through (this is a soft warning, not a hard block).
   - Core modules can't be disabled at all — the button is grayed out.
5. Every toggle is recorded in the audit log (`audit_logs` table — same one
   used for every other mutation in this app) with who made the change and
   when.

## What "disabled" actually means

Disabling a module **never deletes data**. It's a single boolean flip. When
disabled:
- The feature's nav item disappears for that school's users.
- Its pages show a "not enabled" message instead of the normal content.
- Its API routes (where they exist) return a 403.
- Direct database access to its tables is blocked by Row-Level Security.

Re-enabling immediately restores full access to whatever data was already
there — nothing needs to be re-imported or reconstructed.

## Adding a new toggleable feature

See `docs/adding-a-new-module.md` — this only needs code changes when a new
feature is being built; you don't need to touch code to toggle existing
ones.
