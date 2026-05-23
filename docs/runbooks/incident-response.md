# Incident response

## Severity definitions

- **P0** - active data breach, complete outage, payment double-charging.
  Drop everything. Page everyone.
- **P1** - feature broken for a whole role (e.g. teachers can't mark
  attendance). Fix today.
- **P2** - feature broken for a few users, or visual bugs. Fix this week.
- **P3** - cosmetic / minor. Backlog.

---

## P0: data breach suspected

Acted on suspicion, not confirmation. False alarms are cheap; missed breaches
aren't.

1. **Rotate all secrets immediately.** See `rotate-secrets.md`.
2. **Snapshot the database.**
   - In Supabase dashboard -> Database -> Backups -> create on-demand backup.
3. **Pull the audit log for the suspected window.**
```sql
   SELECT * FROM audit_logs
   WHERE created_at > NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC;
```
4. **Determine scope.** Which schools? Which data types?
5. **Notify affected schools within 24 hours.** Email the principal directly,
   plain language. Include: what happened, what data was exposed, what we're
   doing about it. Do NOT speculate beyond what's confirmed.
6. **Post-incident review within 1 week.** Written. Shared internally.

---

## P0: payment double-charge

1. **Pause the Paystack webhook handler.** In the API, flip the feature
   flag `payments.webhook_enabled = false`.
2. **Reconcile from Paystack's dashboard.**
   - Find transactions where the same `reference` appears more than once.
3. **Refund duplicates.** Use Paystack's refund API (not manual M-Pesa).
4. **Notify affected parents.** Direct, apologetic, with the refund timeline.
5. **Re-enable webhook handler.** Only after the bug fix is deployed and
   tested in staging.

---

## P0: complete outage

1. **Check status pages in this order:**
   - Vercel: https://www.vercel-status.com/
   - Supabase: https://status.supabase.com/
   - Cloudflare: https://www.cloudflarestatus.com/
   - Railway / Fly: respective status pages
2. **If a provider is down:** acknowledge to users via the public status
   page (Better Stack), wait it out. Don't make changes during a provider
   outage - you'll make it worse.
3. **If providers are healthy:** check Sentry for new error spikes. Roll
   back the most recent deployment. The most recent deployment is the most
   likely cause.
4. **Communicate.** Update status page every 30 minutes minimum, even with
   "still investigating."

---

## P1: feature broken for a role

1. **Reproduce.** With a real test account at that role.
2. **Check Sentry** for the error.
3. **Check the audit log** to see what the user was doing.
4. **Fix forward** if a hotfix is small. **Roll back** if not.
5. **Notify affected users** once fixed - don't leave them guessing.
