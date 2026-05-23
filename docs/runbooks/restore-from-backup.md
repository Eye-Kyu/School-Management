# Restore from backup

Run this drill **at least monthly** even when nothing is broken. A backup
you haven't restored from doesn't exist.

## What to restore where

| Source backup       | Restore target           | Use case               |
|---------------------|--------------------------|------------------------|
| Supabase auto       | Throwaway Supabase project | Monthly verification |
| Our R2 nightly dump | Throwaway local Postgres | Disaster recovery     |

**Never restore directly into production.** Always to a separate database,
verify, then swap pointers.

## Monthly drill: restore last night's R2 dump

1. **Get the latest backup file from R2:**
```bash
   aws s3 cp s3://<r2-bucket>/backups/ ./backups/ \
     --recursive --endpoint-url "$R2_ENDPOINT"
```
   Pick the most recent `backup-*.sql.gz`.

2. **Start a clean local Postgres:**
```bash
   docker compose -f infra/docker/docker-compose.yml down -v
   docker compose -f infra/docker/docker-compose.yml up -d
   sleep 5
```

3. **Run the restore script:**
```bash
   ./infra/scripts/restore.sh \
     ./backups/backup-YYYYMMDD-HHMMSS.sql.gz \
     postgresql://postgres:dev@localhost:5432/school_manager
```

4. **Verify row counts match yesterday's production:**
```sql
   SELECT count(*) FROM schools;
   SELECT count(*) FROM users;
   SELECT count(*) FROM students;
   SELECT count(*) FROM attendance_records;
   SELECT count(*) FROM audit_logs;
```
   Compare against production counts (within +/- one day of changes).

5. **Sanity-check one specific record:**
   Pick a school, query its admin user, attendance records for last week.
   Confirm they look right.

6. **Document the drill** in `docs/runbooks/backup-drill-log.md` (create
   the file if it doesn't exist). One line per drill: date, file restored,
   row counts, outcome.

## Disaster recovery: full production restore

1. Stand up a fresh Supabase project (or new Postgres instance).
2. Restore the most recent backup using the steps above.
3. Update `DATABASE_URL` and `DIRECT_URL` in the API's secrets store.
4. Redeploy the API. It should connect to the new database.
5. Notify users of the recovery window (data lost: anything between last
   backup and the incident).
6. Post-incident review within 48 hours.
