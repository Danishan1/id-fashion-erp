# Sales & Marketing — Phase 01 Foundation (2026-10-28)

Scope: the module shell only. No Sales & Marketing records exist yet. Decisions (asked 2026-10-28):
- The old standalone Marketing module is **removed now**, including its data.
- Sales & Marketing goes to the **same roles as CRM**.

## What was built

| Area | Result |
|---|---|
| Permission module | `sales_marketing` in `src/config/rbac.ts`; MANAGEMENT and MERCHANDISER get the same actions they have on `crm`; SUPER_ADMIN all; VIEWER view |
| Package | `SALES_MARKETING` replaces `MARKETING` in `src/config/module-entitlements.ts` (plans/companies renamed by migration) |
| Sidebar | "Sales & Marketing" group → Dashboard (`/sales-marketing`); replaces the old "Marketing" group. Later phases add their own leaves |
| Page protection | `layout.tsx` asserts `sales_marketing.view` (404 otherwise); `src/proxy.ts` sends users without it to `/no-access`, and a turned-off package to `/module-unavailable` |
| Pages | `/sales-marketing` dashboard, `loading.tsx`, `error.tsx` |
| Dashboard | KPI panel says "Not available yet" (no fake numbers); real counts from existing modules the viewer can view (active customers, open buyer enquiries, draft / confirmed-not-shipped sales orders — branch-scoped like the Sales Orders list); CRM link; module section map with the phase that builds each section |
| API | `GET /api/v1/sales-marketing/overview` (session + `sales_marketing.view`) |
| Shared UI | `src/components/ui/PageHeader.tsx`, `src/components/ui/PageStates.tsx` (generic). `CrmPageHeader` / `CrmStates` now delegate to them; `SalesMarketingPageHeader` roots crumbs at "Sales & Marketing" |
| Section map | `src/modules/sales-marketing/sales-marketing-sections.ts` (client-safe). A section gets `status: "AVAILABLE"` + `href` and a sidebar leaf in the same change that builds it |

No new tables, events or settings: nothing in Phase 01 needed them. Audit logging, events and settings arrive with the first phase that writes data.

## Legacy Marketing removal

Deleted: `/marketing` (dashboard, channel performance, customer segments, ad integrations), `/campaigns`, `/imports`; APIs `campaigns`, `campaign-alerts`, `campaign-attributions`, `ad-integrations`, `marketing`, `imports`, `customers/segments`, `customers/category-breakdown`, `customers/generate-reengagement-followups`; `src/modules/marketing`, `customer-segments.service`, `CsvImportModal`, the campaign CSV importer in `import.service`.
Kept: CRM's free-text UTM / campaign-source fields on leads, `core/security/encryption.ts` (used by AI providers and CRM).

## Database

| Migration | What it does | Rollback |
|---|---|---|
| `20261028240000_remove_legacy_marketing` | Deletes campaign import batches and CAMPAIGN sequences; drops `crm_leads.campaign_id`, the 6 `mkt_*`/`ad_*` tables and 8 enum types; removes `CAMPAIGN` (DocumentType) and `CAMPAIGN_DAILY_METRIC` (ImportBatchType); deletes `marketing.*` permissions (grants/overrides cascade) | `prisma/rollback/…remove_legacy_marketing.down.sql` recreates the schema **empty**; data and role grants come back only from the pre-deploy backup |
| `20261028250000_sales_marketing_foundation` | Adds the 13 `sales_marketing.*` permissions; copies every role grant and user override from `crm.*`; renames package key `MARKETING` → `SALES_MARKETING` in plans and company overrides | `…sales_marketing_foundation.down.sql` (run first) |

Deploy: back up → `prisma migrate deploy` → `scripts/sync-permission-catalog.mjs` (adds nothing new; reports no stale keys) → restart app and worker.

## Verification (2026-10-28, cloud sandbox copy of the repo)

- All migrations applied in order to an empty Postgres 16, seeded, then legacy fixtures inserted (campaign, metric, import batch, CAMP sequence, marketing grants, a custom role with `crm.view/edit`, a `crm.export` user override, a `MARKETING=false` company override); the two new migrations applied cleanly. Checks: no `mkt_`/`ad_` tables or campaign types left; enum values equal `schema.prisma`; `sales_marketing` grants equal `crm` grants for every role incl. the custom one; override copied; package renamed in plan and company rows. Permission sync: 0 to add.
- Rollback rehearsal: both down scripts ran; schema equal to the pre-migration dump except enum value order; re-applied forward cleanly.
- `prisma validate`, `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` 3708 passed / 218 skipped (264 files) — 16 new tests.
- Live (dev server on the sandbox DB): Super Admin sees the group and dashboard with real counts; `/marketing`, `/campaigns`, `/imports`, `/api/v1/campaigns` → 404; a STORE_MANAGER user gets no sidebar entry, `/sales-marketing` → `/no-access`, API → 403; with the package turned off the page → `/module-unavailable`; CRM pages unchanged (breadcrumbs, no page errors).
- Not run against the user's own database (not reachable from the sandbox).

## Phase 02 — proposed scope (needs approval and a requirements document)

Sales Enquiries + Quotations: enquiry capture/qualification, quotation document (`QUO-` company-wide numbering) with versions/revisions, lines against Styles + variants, currency and tax, PDF, send/accept/reject, link to CRM company/contact/opportunity (register a `QUOTATION` provider in `crm-opportunity-erp.service.ts`).
Open decisions first: how Sales Enquiries relate to Buyer Enquiries and CRM leads; approval rules for quotations; whether pricing (Phase 03) is needed before quotations can be priced.
