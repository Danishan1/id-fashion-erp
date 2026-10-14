# Platform SaaS — Production Runbook

How to deploy, verify and (if needed) roll back the Platform SaaS layer (Phases 1–5):
platform operators, customer-approved support access, company and module management,
subscriptions with trial and grace period, coupons and support tickets.

Last verified: 2026-10-14 (Phase 6).

---

## 1. Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL 16. |
| `AUTH_SECRET` | Yes | `npx auth secret`. Rotating it signs every user and operator out. |
| `NEXTAUTH_URL` | Yes | Public URL of the app. |
| `REDIS_URL` | Yes | BullMQ queue for the worker (subscription lifecycle job, imports, CRM jobs). |
| `FILE_STORAGE_ROOT` | Yes | Writable directory outside the web root (attachments, ticket files). |
| AI keys (`ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, …) | Optional | Only for the AI modules. |

The app process (`npm start`) and the worker process (`npm run worker`) both need the same
environment. Run exactly one worker per database; the queue name already includes a hash of the
database, so two environments sharing one Redis do not collide.

## 2. Deploy steps (every release)

Run in this order. Steps 2–4 are safe to repeat.

1. `npm ci && npx prisma generate && npm run build`
2. `npx prisma migrate deploy` — applies any pending migrations.
3. `node --experimental-strip-types --no-warnings scripts/sync-permission-catalog.mjs`
   - Adds any permission keys added to `src/config/rbac.ts` since the last release.
   - Grants brand-new keys to the system roles that should have them, and the full set to SUPER_ADMIN.
   - It never removes anything and never re-grants a permission an admin deliberately took
     away from a role. Stale keys are only reported.
   - Run with `--dry-run` first if you want to see what it will do.
4. Restart **both** the app and the worker. Permissions are cached in memory per process, so a
   catalog change is only picked up after a restart.
5. Smoke check: `GET /api/v1/health` returns 200, then sign in at `/login` and at `/platform/login`.

## 3. First-time setup (new installation)

1. Steps 1–2 above, then `npx prisma db seed`, then step 3 above.
2. The seed creates a demo company with a Super Admin **and** a platform operator, both
   `admin@indradhar.com` / `ChangeMe123!`. **Change both passwords immediately** (or delete the
   demo company and create real ones). The two accounts are separate identities — changing one does
   not change the other.
3. Subscriptions: the migration that adds subscriptions back-filled every company that existed at
   the time onto the "Standard" plan with no expiry. On a fresh install the seed runs **after**
   that migration, so the seeded company has **no subscription row**. That means all modules are
   on and nothing expires. If you keep that company, give it a plan in the platform portal
   (Companies → the company → Subscription).
4. Companies created afterwards through the platform portal get a trial on the chosen plan.

## 4. Verification scripts

All are in `scripts/qa/`. Run them against local or staging only — never production.

| Script | What it proves | Run |
|---|---|---|
| `rehearse-migrations.mjs` | All migrations, the seed and the permission sync apply cleanly to an empty database, and the result matches `schema.prisma`. Uses a throwaway `<db>_rehearsal` database. | `node --env-file=.env scripts/qa/rehearse-migrations.mjs` |
| `rehearse-rollback.mjs` | Copies the database (`pg_dump`/`pg_restore`), runs every rollback script, checks the SaaS tables are gone and core business data is untouched, then re-applies the migrations and checks the schema again. Uses a throwaway `<db>_rollback_staging` database. Needs `PG_BIN` if the Postgres tools aren't on PATH. | `node --env-file=.env scripts/qa/rehearse-rollback.mjs` |
| `verify-tenant-isolation.mjs` | With the app running: creates (or reuses) a second test company and checks it can't read or change the first company's records through any `/api/v1/**/[id]` route, list, attachment, ticket or support request; that platform and customer sessions can't use each other's APIs; and that suspending a company kills its live sessions. Leaves the test company suspended. | `BASE_URL=http://localhost:3000 node --env-file=.env scripts/qa/verify-tenant-isolation.mjs` |

Results on 2026-10-14: migration rehearsal passed (173 migrations, no drift); rollback rehearsal
passed (5 rollbacks, 16 core tables unchanged, clean roll-forward); isolation sweep 140/140.

## 5. Rollback

Rollback scripts live in `prisma/rollback/`, one per SaaS migration. Each one also removes its own
row from `_prisma_migrations`, so `prisma migrate deploy` can re-apply it later.

**Before you start:** take a full backup (`pg_dump -Fc`). Deploy the previous application release
first — the current code expects these tables and will fail without them. Then run the scripts
**newest first**, one at a time, each in its own transaction:

| Order | Script | Data lost |
|---|---|---|
| 1 | `20261014100000_coupons_and_support_tickets.down.sql` | All coupons, redemptions, support tickets and their messages. Ticket attachment files stay on disk (delete them by hand if needed). Coupon fields on recorded payments. |
| 2 | `20261013160000_subscriptions_trials_grace.down.sql` | All plans, company subscriptions and recorded payments. Companies then have no trial or expiry. |
| 3 | `20261013140000_company_lifecycle_and_module_entitlements.down.sql` | Per-company module on/off settings, and the suspension reason/date/operator. A suspended company stays suspended (`companies.is_active` is kept). |
| 4 | `20261013120000_support_access.down.sql` | Every support access request, session and the support audit log. Support proxy users are kept but suspended. |
| 5 | `20261013100000_platform_users.down.sql` | Platform operator accounts, and which operator performed a platform audit entry (the audit entries themselves are kept). |

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f prisma/rollback/<script>.down.sql
```

Only roll back as far as you need — e.g. rolling back just script 1 removes coupons and tickets
and leaves everything else in place. After a partial rollback, deploy the release that matches the
remaining migrations.

## 6. Operational notes

- **Suspending a company** (platform portal) takes effect on the customer's next request: pages
  redirect to `/account-suspended`, APIs return 403 `ACCOUNT_SUSPENDED`, logins are refused.
- **Subscription lapse:** after the period ends the company has 7 days of grace, then is read-only
  (it can view, print and export, but not change anything). Recording a payment in the portal lifts
  it immediately.
- **Lifecycle notices** (trial ending, grace started, expired) come from the hourly
  `subscription.lifecycle` worker job. If the worker is down, access rules still apply — only the
  in-app notices stop.
- **Support access** always needs the customer's Super Admin to approve it with a code; there is
  no override. Every support action is in the support audit log, which the database refuses to edit.
- **Adding a new ERP module:** add it to `src/config/rbac.ts` and to a package in
  `src/config/module-entitlements.ts` (a test fails otherwise), give it a sidebar link (pages
  without one are not module-gated), then run the permission sync on deploy.
