# Onboard a new school

This runbook covers the v0.1 onboarding flow. As features ship in v0.2+, add
steps for notifications setup, payment account linking, etc.

**Total time:** 1-2 hours of admin work + 1 hour of training the school
office staff.

## Before the meeting

- [ ] School has signed an LOI or contract.
- [ ] School has provided: school name, slug preference, principal name &
      email, phone number, mailing address.
- [ ] We've agreed on which classes/grades to onboard first (start narrow:
      one or two classes, not the whole school).

## Step 1: Create the school in production

As a platform admin via the seed script (real admin UI arrives in v0.4):

```bash
# Adjust the seed script or run a one-off script
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm --filter @school-manager/db tsx scripts/create-school.ts \
  --name "Saint Mary's Primary" \
  --slug saint-marys
```

Verify:
```sql
SELECT id, name, slug FROM schools WHERE slug = 'saint-marys';
```

## Step 2: Create the principal's admin account

Use Supabase dashboard -> Auth -> Add user. Set a temporary password and
require change on first login.

Then mirror them in our `users` table:
```sql
INSERT INTO users (school_id, auth_id, email, full_name, role)
VALUES ('<school-id>', '<auth-id>', 'principal@school.tld', 'Jane Mwangi', 'ADMIN');
```

## Step 3: Walk the principal through their dashboard

In person or video call. About 60 minutes. Cover:
1. Logging in and changing the temporary password.
2. Creating classes (Grade 5 Blue, etc).
3. Creating subjects.
4. Adding the first teacher account.
5. Uploading the student CSV.
6. Reviewing the timetable grid.

## Step 4: Send the welcome email

Subject: Welcome to School Manager - your account is ready.
Body: login URL, the principal's username (not the password - they should
already have it), a link to the parent-onboarding guide, and our support
email.

## Step 5: Mark them as onboarded

In our internal CRM (Notion for now), update the school's record:
- Status: Live
- v0.1 features enabled: timetable, attendance, arrears, announcements
- Pilot end date (for free pilots): set
- Next check-in: 1 week from now
