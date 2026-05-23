# Local development dependencies

`docker-compose.yml` spins up Postgres 16 and Redis 7 for local dev.

## When to use this vs Supabase

- **Use Supabase for**: anything touching Supabase Auth, Storage, Realtime,
  or RLS policies you're actively writing. RLS in plain Postgres works but
  Supabase's Auth integration (`auth.uid()`) doesn't exist unless you set
  up the auth schema yourself.
- **Use local Postgres for**: unit/integration tests, offline work, schema
  experimentation. Faster, no free-tier worry.

## Start / stop

```bash
docker compose -f infra/docker/docker-compose.yml up -d
docker compose -f infra/docker/docker-compose.yml down
```

## Wipe and start fresh

```bash
docker compose -f infra/docker/docker-compose.yml down -v
```

## Connect

```bash
psql postgresql://postgres:dev@localhost:5432/school_manager
redis-cli -h localhost -p 6379
```
