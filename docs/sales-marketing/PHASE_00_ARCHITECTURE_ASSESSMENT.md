# Sales & Marketing — Phase 00 Architecture Assessment (2026-10-28)

Branch: `sale-marketing`. Inputs: the Sales & Marketing implementation brief (pasted in chat, 2026-10-28).

**Missing input:** there is no separate "Sales & Marketing Feature Requirements Document" in the repository. Until one is added under `docs/sales-marketing/`, the brief's module structure (§4) and roadmap (§7) are the functional specification. Phase 02 needs its own detailed requirements before it starts.

## 1. Stack and conventions (verified in code)

| Area | What exists | Where |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, Tailwind 4; pages under `src/app/(dashboard)/<module>/` | `src/app` |
| Backend | Route handlers under `/api/v1/...`; `requireSession()` → `PermissionService.assert()` → service; errors through `handleApiError()` | `src/lib/api-route.ts` |
| Modules | `src/modules/<module>/` with `*.schema.ts` (zod) / `*.repository.ts` / `*.service.ts` / tests | — |
| Database | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`); hand-written SQL migrations in `prisma/migrations`; a down script per migration in `prisma/rollback` | `prisma/` |
| Multi-tenancy | `companyId` on every business table; branch restriction via `PermissionService.getAllowedBranchIds()` + `branchScopeWhere()` | `src/lib/branch-access.ts` |
| RBAC | Module × action catalog; built-in role grants; admin-editable role matrix and per-user overrides | `src/config/rbac.ts`, `src/core/rbac/PermissionService.ts` |
| Module packages | Platform turns whole packages on/off per company and per plan | `src/config/module-entitlements.ts`, `EntitlementService` |
| Navigation | Sidebar config is also the page→module map used by `src/proxy.ts` for page protection (`/no-access`, `/module-unavailable`) | `src/components/layout/navigation.ts`, `src/core/entitlements/route-modules.ts` |
| Audit | `writeAuditLog()` (optionally in a transaction) | `src/core/audit/AuditLogger.ts` |
| Events | CRM-specific outbox `crm_events` + `runCrmMutation()`; no ERP-wide event bus | `src/modules/crm/core/` |
| Jobs | BullMQ worker (`npm run worker`) | `src/core/jobs/worker.ts` |
| Numbering | `generateDocumentNumber()` / `document_sequences` | `src/core/numbering/` |
| Files | `AttachmentService` + `FileStorage` | `src/core/attachments`, `src/core/file-storage` |
| Reports | `registerReport()` + Report Center | `src/modules/reports/` |
| Notifications | `NotificationService` | `src/core/notifications/` |
| Tests / checks | Vitest (`npm test`), `tsc --noEmit`, `eslint`, `next build`; QA scripts in `scripts/qa/` | — |

## 2. Reusable modules for Sales & Marketing

- **CRM** (rebuilt 2026-10, phases 00–22 partly built): leads, contacts, companies (`crm_companies.customer_id` → ERP Customer), opportunities with pipelines/stages and ERP document links, activities, calendar, inbox, message templates, workflows, bulk actions, dashboard, webhooks. Sales & Marketing must link to these records, not copy them.
- **Customers / Buyers / Sales Agents / Products (Styles) / Currencies / Tax rates** — the masters.
- **Buyer Enquiries** (Merchandising) — an existing pre-sample enquiry document. Phase 02 must decide whether Sales Enquiries reuse, extend or sit in front of it.
- **Sales Orders** — full order execution: BOM, production, dispatch, FG reservation and invoicing depend on it. Phase 04 integrates with it; it is not rebuilt.
- **Sales Invoices / Custom Invoices / Payments** — finance side.
- **Inventory / FG stock** — availability for quotations later.
- **Bulk action engine, CRM message templates, CRM workflow engine** — candidates for campaigns (phases 08–15).

## 3. Missing capabilities (to build in later phases)

Sales enquiries, quotations (the ERP has no quotation document — CRM's opportunity ERP-link registry has a placeholder for one), price lists, discount rules and approvals, targets, territories, forecasting, sales channels, commissions, campaigns, segmentation, marketing channel providers, promotions, budgets, attribution, S&M reports, AI insights.

## 4. Integration boundaries and data ownership

| Data | Owner | Sales & Marketing relation |
|---|---|---|
| Customer master | Masters (`customers`) | Reference by id only |
| Prospects / people / companies | CRM (`crm_contacts`, `crm_companies`, `crm_leads`) | Reference by id only |
| Opportunities / pipeline | CRM | Quotations link to an opportunity (Phase 02) |
| Orders | Sales Orders | Quotation → Sales Order hand-off (Phase 04) |
| Prices, discounts, targets, campaigns | Sales & Marketing (new tables per phase) | Owned |
| Invoices, payments, ledger | Accounts | Read-only for analytics |

## 5. Risks

1. **Overlap with Buyer Enquiries and CRM leads** — three "enquiry"-shaped records would confuse users. Phase 02 must settle this first.
2. **Legacy Marketing module** — removed in Phase 01 (user decision), together with its data.
3. **Document numbering** — `document_sequences` counts per branch while some document tables are unique per company (known issue, see CLAUDE.md). New S&M documents should be numbered company-wide (`branchId: null`) like CRM documents.
4. **No ERP-wide event bus** — CRM's outbox is CRM-only. Automation across S&M (Phase 15) needs either a shared outbox or a deliberate extension of the CRM one.
5. **Permission granularity** — one `sales_marketing` module for now; each later phase adds its own module (as HRMS did) so roles can be scoped per screen.

## 6. Phase plan

As in the brief §7 (phases 01–18), one phase at a time, each with its own assessment, acceptance criteria and approval. Phase 01 = the module shell only.
