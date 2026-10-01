# CRM Phase 01 — Foundation: Report & Test Checklist

_Date: 2026-10-01 · Branch: `crm-marketing-rebuild-v1` · Not committed yet._

## What was built

A CRM module shell inside the ERP. It reuses ERP login, permissions (`crm` module), audit log and UI primitives, and adds no user, role or permission tables. No Leads / Contacts / Opportunities / Workflows yet.

| Area | Delivered |
|---|---|
| Navigation | Sidebar group **CRM** → Dashboard, Activity Log (visible only with `crm.view`). Only one leaf is highlighted on nested pages (a fix that also applies to AI Garment Flow). |
| Routes / layout | `/crm` (dashboard shell) and `/crm/activity` (activity log). `crm/layout.tsx` requires `crm.view` (404 otherwise); `loading.tsx` / `error.tsx` boundaries keep the ERP shell working if a CRM page fails. |
| Dashboard shell | Live "Recent activity" timeline plus an honest empty "Pipeline summary" (no numbers until records exist; KPIs come in Phase 32). |
| Shared components (`src/components/crm/`) | `CrmPageHeader` (breadcrumb rooted at CRM), `CrmRecordHeader`, `CrmBadge`, `CrmTable` (search + filter panel over the shared DataTable, synced to the URL for drill-down links), `CrmFilterBar` (definition-driven, draft → Apply, date presets), `CrmSearchInput` (debounced), `CrmTimeline` (day-grouped, Load more), `CrmActivityItem`, `CrmDrawer` (slide-over), `CrmLoadingState` / `CrmEmptyState` / `CrmErrorState`. |
| API namespace | `crmRoute(action, handler)` wrapper (session → `crm.<action>` → handler → standard errors) and `crmListResponse`. Endpoints: `GET /api/v1/crm/events`, `GET /api/v1/crm/events/:id`. |
| Event infrastructure | `crm_events` append-only table + `CrmEntityType` enum; typed event registry (`crm-event-types.ts`, names match the integration plan); `runCrmMutation()` writes the change, its AuditLog row and its events in **one transaction**, then notifies in-process subscribers (`crm-event-bus.ts`) after commit. |
| Audit integration | `writeAuditLog` gained an optional transaction argument (backward compatible) so CRM audit rows commit with the change. |
| Record visibility | `getCrmRecordScope()` / `crmOwnerWhere()` hook — returns **ALL** until decision D5 is made; every CRM query from Phase 02 must use it. |
| Dev helper | `scripts/crm-dev-sample-events.mjs` adds / removes 8 labelled sample events for UI testing. |

## Database

Migration `20261001120000_crm_foundation`: enum `CrmEntityType` (LEAD, CONTACT, COMPANY, OPPORTUNITY) and table `crm_events` (company, entity type/id, event type, summary, payload, actor, correlation id, occurred at; 3 indexes; FKs to `companies` and `users`). Additive only.

## Files

**New (43):** `prisma/migrations/20261001120000_crm_foundation/migration.sql`, `scripts/crm-dev-sample-events.mjs`, `src/modules/crm/core/*` (10 source + 7 tests), `src/components/crm/*` (12 source + 2 tests), `src/app/(dashboard)/crm/{layout,page,loading,error}.tsx`, `src/app/(dashboard)/crm/activity/{page,ActivityLogClient}.tsx`, `src/app/api/v1/crm/events/{route.ts,route.test.ts,[id]/route.ts}`, `src/components/ui/DataTable.extraParams.test.tsx`.

**Modified (7):** `prisma/schema.prisma` (+CrmEvent, back-relations on Company/User), `src/core/audit/AuditLogger.ts` (optional tx), `src/components/ui/DataTable.tsx` (additive `extraParams`, `hideSearch`, `toolbar`), `src/components/layout/navigation.ts` (+CRM group, `isLeafActive`), `src/components/layout/Sidebar.tsx`, `src/components/layout/navigation.test.ts`, `CLAUDE.md`.

## Automated verification (sandbox copy)

- Vitest: **120 files / 2,110 tests passing** (54 new tests; every existing test still passes).
- `tsc --noEmit` (after `next typegen`): clean. ESLint: 0 errors (12 pre-existing warnings, none in new code).
- All 152 migrations applied to an empty Postgres 16 DB, seed runs; DB tables/enums match `schema.prisma`.
- Browser smoke test (headless Chromium against the running app): login → CRM menu → dashboard → activity log (empty and with sample data) → filter by event → URL updates → drawer details → drill-down link `?entityType=LEAD` → Dashboard / Customers / New Sales Order still load → no console errors. A PRODUCTION_WORKER user sees no CRM menu, gets 404 on `/crm` and 403 from the API.

## Manual test checklist (your machine)

```powershell
npx prisma generate
npx prisma migrate deploy        # applies 20261001120000_crm_foundation
npm run dev
```

1. Log in as admin → sidebar shows **CRM** with **Dashboard** and **Activity Log**.
2. Open CRM → Dashboard: "Recent activity" shows *No activity yet*; "Pipeline summary" explains there are no records yet.
3. Open Activity Log: search box, collapsed **Filters** panel, table says *No records found.*
4. Add sample data: `node scripts/crm-dev-sample-events.mjs`, then refresh.
5. Dashboard timeline shows 8 `[Sample]` events grouped by day with who/when.
6. Activity Log: type `stage` in search → 2 rows. Clear it.
7. Filters → Event = *Opportunity won* → **Apply Filters** → 1 row, toggle reads *Filters (1)*, URL has `?eventType=opportunity.won`.
8. Click **View** on the row → drawer with details JSON; Escape or ✕ closes it.
9. Filters → Date → *This Week* → Apply; **Clear All** resets and keeps the panel open.
10. Paste `/crm/activity?entityType=LEAD` in the address bar → only the 2 lead events.
11. Sidebar: on Activity Log only *Activity Log* is highlighted.
12. Regression: open Dashboard, Masters → Customers, Sales Orders → New — all still work.
13. Optional: log in as a user without CRM access → no CRM menu; `/crm` shows Not Found.
14. Remove samples: `node scripts/crm-dev-sample-events.mjs --remove`.

## Integration check

Phase 01 needs no external integration (per `CRM_INTEGRATION_AWARENESS.md`). The event registry uses the exact event names later workflows/webhooks will consume.

## Open items

- **D5 record visibility** (all vs own/team) — needed before Phase 02 is finished.
- D1–D4 (Company↔Customer, Contact↔Buyer, Lead↔Buyer Enquiry, Owner vs Sales Agent) — needed for Phases 02–05.
- `/api/v1/users` requires administration access, so an "owner / performed by" picker for CRM users will need a CRM-scoped user lookup in Phase 02.
