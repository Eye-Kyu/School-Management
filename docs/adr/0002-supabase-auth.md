# ADR 0002 - Supabase Auth for authentication

## Status

Accepted

## Context

We need authentication for four user roles: Admin, Teacher, Student, Parent.
Some schools may not have email addresses for all users; phone OTP is a
fallback. The API (NestJS) must verify tokens independently of the frontend.

## Decision

Use Supabase Auth.

- Email/password for admins and teachers.
- Phone OTP as a fallback for parents and students.
- Supabase issues JWTs; our API validates them via `admin.auth.getUser(token)`.
- A mirror row in `public.users` stores the role and school context.

## Alternatives considered

- **Auth0:** Industry standard. But adds another paid vendor at a price point
  hard to justify before revenue.
- **NextAuth / Auth.js:** Good for web-only. Doesn't extend naturally to the
  mobile app or the NestJS API.
- **Rolling our own:** Full control. But password storage, reset flows, OTP
  delivery, and brute-force protection are each their own rabbit holes.
- **Clerk:** Excellent DX. More expensive, and tightly coupled to Next.js.

## Consequences

**Easier:**
- OTP via SMS is one Supabase config toggle.
- `auth.uid()` in RLS policies - no extra middleware needed.
- Social login (Google, Microsoft) can be added later via the dashboard.

**Harder:**
- Two sources of truth: `auth.users` and `public.users` must stay in sync.
- If we move off Supabase, migrating Auth is harder than migrating the DB.

**Exit strategy if wrong:**
- RLS policies that reference `auth.uid()` would need updating to use a
  custom claim. One migration: `current_setting('app.user_id')::uuid`.
