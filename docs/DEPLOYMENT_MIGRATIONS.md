# Database migrations and deployment

How Jenkins deploys (see `Jenkinsfile`), in order:

1. `npm ci`, `prisma validate`, `prisma generate`
2. **Migration Checks** — `node scripts/check-migrations.mjs` (also `npm run db:check-migrations`)
3. **Unit Tests** — `npm test` with `DATABASE_URL` pointing nowhere. Unit tests never touch a real database.
4. **Build** — `npm run build`
5. **Production Database Migration** — `prisma migrate deploy`, then `scripts/sync-permission-catalog.mjs`
6. **Deploy Files** — rsync to the server
7. **Restart** — pm2 restart (web, and the worker if it runs under pm2)

If anything fails before step 5, the database is not touched. If step 5 fails, the live app is not
changed (files are not copied, app is not restarted). Two builds never run at the same time.

## Rules for writing migrations

- **Never edit a migration that is already committed.** Prisma stores a checksum of each applied
  migration; an edited file no longer matches. Put the change in a NEW migration. The check fails
  the build if a committed `migration.sql` was changed.
- Create migrations with a fresh timestamp: `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`.
  Before merging, pull the latest `main` and make sure your timestamp is later than the newest
  migration there.
- Never include `ALTER TABLE "sample_requests" DROP COLUMN "color"` (known drift). The check blocks it.
- Migrations must be additive where possible (add columns/tables first, remove old ones in a later
  release), because the old app keeps running for a moment after the database is migrated.
- Two branches changing the same table: merge one, rebase the other on `main`, and regenerate its
  migration against the updated schema.

## Database integration tests

They write real data, so they run only against a **disposable** migrated database, never `.env`:

```bash
HRMS_IT_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hrms_it npx vitest run src/modules/hrms/attendance.integration.test.ts
```

CRM tests use `CRM_IT_DATABASE_URL`, bulk-action tests `BULK_IT_DATABASE_URL` / `BULK_IT_REDIS_URL`.
Run `npx prisma migrate deploy` against that database first.

## A migration failed on the server

`prisma migrate deploy` stops at the failed migration and refuses to deploy again (error P3009)
until it is resolved. On the server, with the production `.env`:

1. `npx prisma migrate status` — find the failed migration name.
2. Look at what part of it ran (the database may have half of it).
3. Either fix the database by hand and mark it done:
   `npx prisma migrate resolve --applied <migration_name>`
   or undo what ran and mark it rolled back so the next deploy retries it:
   `npx prisma migrate resolve --rolled-back <migration_name>`
4. Fix the cause in a NEW commit (if the SQL itself was wrong and it never applied anywhere,
   correcting that same migration is fine), push, and run the Jenkins job again.
