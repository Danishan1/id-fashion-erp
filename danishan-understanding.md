# Fashion ERP — CRM & Marketing: Current-State Understanding

_Analysis date: 2026-09-30 · Branch analysed: `main` (HEAD `bec05bb`) · Read-only analysis, no code changed._

> **Status update (2026-10-01):** the CRM and Marketing modules described below have been **removed** on branch `crm-marketing-rebuild` so they can be redesigned from scratch. Sections 3–8 now describe what *used to* exist, for reference only. See "Removal log" at the end.

---

## 1. Project overview

- Garment-manufacturing ERP, multi-company (every business table carries `companyId`), with optional `branchId`.
- **Stack:** Next.js 16.3 (App Router) · React 19.2 · TypeScript · Tailwind v4 · Prisma 7.9 (`@prisma/adapter-pg`) on PostgreSQL · NextAuth v5 beta (JWT) · Zod 4 · BullMQ + ioredis (one worker) · Vitest · exceljs / @react-pdf/renderer · AI SDKs (Anthropic, OpenAI, Gemini).
- Scale: `prisma/schema.prisma` ≈ 10.3k lines, 151 migrations, ~37 feature modules.
- Heavy existing documentation at root. `CLAUDE.md` (≈820 KB, 7.6k lines) is the dated build log — the source of truth for past decisions.

## 2. Architecture / structure

```
src/app/(dashboard)/<feature>/     UI pages (server pages + *Client.tsx / *Form.tsx / *WorkflowPanel.tsx)
src/app/api/v1/<resource>/route.ts REST handlers (thin)
src/modules/<domain>/              *.schema.ts (Zod) · *.repository.ts (Prisma) · *.service.ts (business rules) · *.test.ts
src/core/                          cross-cutting services (rbac, audit, numbering, notifications, attachments, ...)
src/components/{ui,layout,reports} shared UI
src/config/rbac.ts                 module/action/role catalog (seeded into DB)
src/lib/                           helpers (api-route, list-query, money, csv/xlsx, validation, communication)
prisma/                            schema, migrations, seed.ts
```

**Standard request flow** (e.g. `src/app/api/v1/leads/route.ts`):
`requireSession()` → `PermissionService.assert(userId, "crm", "create")` → `schema.parse(body)` → service fn(`actor`, input) → `NextResponse.json({ data })`; errors via `handleApiError` / `BusinessRuleError`. Lists use `parseListQuery` + `buildListMeta`.

## 3. CRM — what exists

Built in two waves: **Aug 23–24 2026** (Leads/Deals + 14-item enhancement pass) and **Sep 27–28 2026** ("CRM Lead-to-Customer upgrade", slices 1–3 of a 12-slice plan, merged to `main`).

| Area                                                                                                                           | Status                                                                                                | Where                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Leads CRUD, numbering, list with URL filters/segments                                                                          | Implemented                                                                                           | `modules/crm/lead.*`, `/leads`, `api/v1/leads`                                     |
| Configurable pipeline stages (`kind` OPEN/WON/LOST/DORMANT), sources, lost reasons + Settings page                           | Implemented                                                                                           | `crm-config.service.ts`, `crm-defaults.ts`, `/crm/settings`, `api/v1/crm/*`      |
| Stage change (only via`changeLeadStage()`), stage & assignment history                                                       | Implemented                                                                                           | `api/v1/leads/[id]/stage`, `/history`                                                |
| Garment-specific lead fields (category, season, product interests, qty, target price, MOQ, delivery, sampling/tech-pack flags) | Implemented                                                                                           | `Lead` model                                                                           |
| Lead scoring → quality COLD/WARM/HOT (configurable thresholds), stored priority                                               | Implemented                                                                                           | `crm-settings.*`                                                                       |
| Round-robin assignment                                                                                                         | Implemented                                                                                           | `CrmRoundRobinState`                                                                   |
| Duplicate check (email, cross-phone, company+country), live check + merge                                                      | Implemented                                                                                           | `/leads/duplicate-check`, `/leads/[id]/merge`                                        |
| Lead 360 detail tabs: Overview, Timeline, Contacts, Activities, Follow-ups, Requirements, Samples, Files, Notes, Opportunities | Implemented                                                                                           | `leads/[id]/*Tab.tsx`, `LeadWorkflowPanel.tsx`                                       |
| Lead**Quotations** tab                                                                                                   | **Placeholder text only**                                                                       | `LeadWorkflowPanel.tsx:582`                                                            |
| Lead → create Sample Request                                                                                                  | **Not implemented** (Samples tab only shows ones linked via Buyer Enquiry)                      | `LeadWorkflowPanel.tsx:561-567`                                                        |
| Deals ("Opportunities"): CRUD, stage guard, weighted value, Kanban board, leaderboard                                          | Implemented                                                                                           | `deal.*`, `/deals`, `/deals/board`                                                 |
| Deal → Customer conversion (create/link)                                                                                      | Implemented                                                                                           | `convertDealToCustomer()`, `api/v1/deals/[id]/convert-to-customer`                   |
| Deal → Sales Order (`SalesOrder.originatingDealId`)                                                                         | Implemented (via link from Deal page → SO form)                                                      | `DealWorkflowPanel.tsx:266`, `sales-order.service.ts:236`                            |
| Activities (CALL/WHATSAPP/EMAIL/MEETING/NOTE) & follow-ups (polymorphic`relatedModule`+`relatedRecordId`)                  | Implemented                                                                                           | `crm-activity.*`, `/follow-ups`, `api/v1/crm-activities`, `api/v1/crm-followups` |
| Follow-up notifications                                                                                                        | Implemented,**manually triggered** (button)                                                     | `generateFollowupNotifications()`                                                      |
| CRM dashboard (KPIs, funnel, trends, source/rep performance, click-through)                                                    | Implemented                                                                                           | `crm-dashboard.service.ts`, `/crm`                                                   |
| CSV import of Leads/Deals                                                                                                      | Implemented                                                                                           | `modules/import`, `/imports`                                                         |
| Customer 360                                                                                                                   | Implemented (existing data only)                                                                      | `modules/customers/customer-360.service.ts`, `/masters/customers/[id]/360`           |
| Outbound messaging (WhatsApp/email/telephony APIs)                                                                             | **Interface only** — `ManualCommunicationProvider` sends nothing; UI uses tel:/mailto:/wa.me | `core/communication/CommunicationProvider.ts`, `lib/communication.ts`                |

Key models (`schema.prisma` ~2517–2970): `Lead`, `Deal`, `CrmActivity`, `CrmFollowup`, `CrmPipelineStage`, `CrmLeadSource`, `CrmLostReason`, `CrmStageHistory`, `CrmAssignmentHistory`, `CrmLeadContact`, `CrmLeadProductInterest`, `CrmSettings`, `CrmRoundRobinState`. Tables prefixed `crm_`.

## 4. Marketing — what exists

| Area                                                                                         | Status                                                                                             | Where                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Campaigns CRUD (10 channels), numbering, status lifecycle                                    | Implemented                                                                                        | `modules/marketing/campaign.*`, `/campaigns`, `api/v1/campaigns`       |
| Campaign approval / rejection                                                                | Implemented (MANAGEMENT has approve/reject)                                                        | `api/v1/campaigns/[id]/approve                                               |
| Daily metrics (spend/impressions/clicks) — manual + CSV import                              | Implemented                                                                                        | `CampaignDailyMetric`, `/campaigns/[id]/daily-metrics`                   |
| Derived metrics: leads, qualified, "customers", revenue, ROAS                                | Implemented (computed live from`Lead.campaignId` → WON leads → WON Deals)                      | `campaign.service.ts:58-82`                                                |
| Attribution records (UTM, first/last touch)                                                  | Implemented (API only; manual entry)                                                               | `CampaignAttribution`, `api/v1/campaign-attributions`                    |
| Alerts (overspend, 80% budget, ROAS, CPL, conversion)                                        | Implemented,**manually triggered** ("Run automation" button)                                 | `api/v1/campaigns/run-automation`, `CampaignAlert`                       |
| Marketing dashboard + trend chart                                                            | Implemented                                                                                        | `/marketing`, `TrendChart.tsx`                                           |
| Channel performance report                                                                   | Implemented                                                                                        | `/marketing/channel-performance`, `api/v1/marketing/channel-performance` |
| Customer segments + re-engagement follow-ups                                                 | Implemented (lives in`modules/customers`)                                                        | `/marketing/customer-segments`, `customer-segments.service.ts`           |
| Meta / Google Ads OAuth + sync                                                               | Code + unit tests exist;**never verified live** (needs `META_APP_*`, `GOOGLE_ADS_*` env) | `modules/marketing/ad-integrations/*`, `/marketing/ad-integrations`      |
| Email/WhatsApp campaign sending, audiences, templates, landing pages/forms, web-lead capture | **Not implemented**                                                                          | —                                                                           |

Key models (~2975–3210): `Campaign`, `CampaignDailyMetric`, `CampaignAttribution`, `CampaignAlert`, `AdAccountConnection` (encrypted tokens), `AdCampaignLink`. Tables prefixed `mkt_` / `ad_`.

## 5. CRM ↔ Marketing relationship

- **`Lead.campaignId` (FK → Campaign)** is the single link. Also `Lead.campaignText` (free text) and `CampaignAttribution.leadId`.
- Campaign KPIs are derived from CRM data: leads per campaign, qualified = `leadScore ≥ warmThreshold` (CRM setting), "customers" = leads in a WON-kind stage (not actual `Customer` rows), revenue = sum of WON `Deal.value` for those leads.
- Customer segmentation (marketing screen) creates CRM follow-ups.
- Import History is shared (nav visible with `crm` or `marketing`).

## 6. Connections to the rest of the ERP

`Lead` → `BuyerEnquiry` (optional unique FK; samples reach the lead through enquiry lines → `SampleRequest`) · `Lead` → `Category`, `Season`, `ProductType` masters · `Deal` → `Customer`, `SalesAgent`, `User` · `SalesOrder.originatingDealId` → `Deal` · `Customer 360` joins Buyers, Sample Requests, Sales Orders, Deals · Notifications (`core/notifications`) · Attachments (lead files) · Audit log on writes.

## 7. Reusable infrastructure (use these, don't rebuild)

- **API/Auth:** `lib/api-route.ts` (`requireSession`, `handleApiError`), `core/rbac/PermissionService`, `config/rbac.ts`.
- **Errors/Logging:** `core/errors/BusinessRuleError`, `core/logging` (request context).
- **Domain services:** `core/audit/AuditLogger` (`writeAuditLog`), `core/numbering/DocumentNumberingService`, `core/notifications/NotificationService`, `core/attachments/AttachmentService` + `core/file-storage`, `core/security/encryption` + `oauth-state`, `core/communication` (provider interface), `core/jobs` (BullMQ; only bulk-import today), `core/reports` (csv/excel/pdf), `core/documents` (PDF templates), `core/submodule-visibility`.
- **CRM internals:** `lead-segments.ts` (one definition for dashboard counts + list filters), `crm-config.service` (`ensureCrmDefaults`, stage lookups by `kind`), `crm-activity.service` (`withRelatedLabels`, polymorphic activities/follow-ups), `computeWeightedValue`.
- **UI:** `DataTable`, `SearchableSelect`, `Modal`/`ConfirmModal`/`ChildFormModal`, `CsvImportModal`, `SimpleLookupManager`, `FormField`, `RowAction`/`ActionMenu`, `Toast`, `FilePreviewModal`, `Breadcrumb`; `components/reports/*`; layout `navigation.ts` (RBAC-filtered sidebar).
- **Lib:** `list-query`, `money`, `currency`, `date-format`, `validation`, `csv`/`xlsx`, `humanize-status`, `use-action-display`.
- **Standards docs:** `DESIGN_SYSTEM.md`, `UI_RULES.md`, `COMPONENT_GUIDELINES.md`, `COMMON_FEATURES.md`, `ROLE_ACCESS_MATRIX.md`.

## 8. Incomplete / not implemented (verified in code)

1. **CRM Quotation** — no model, no API; Lead tab is placeholder text. (Planned per CLAUDE.md.)
2. **Create Sample Request from a Lead** — not wired.
3. **Sales roles** `SALES_MANAGER` / `SALES_EXECUTIVE` and **own-records scoping** — planned in CLAUDE.md, absent from `rbac.ts`. Today only SUPER_ADMIN, MANAGEMENT (crm view/export; marketing view/approve/reject/export) and MERCHANDISER (view/create/edit/export/print) have access.
4. **No branch scoping** in CRM/Marketing services/routes (`branch-access` not used), though `branchId` is stored.
5. **Opportunity pipeline:** `CrmPipeline.OPPORTUNITY` enum value exists but is unused; `Deal` still uses the fixed `DealStage` enum.
6. **Automation** (follow-up notifications, campaign alerts, re-engagement) is button-triggered only; no scheduler. Planned "automation rules" screen not built.
7. **Nav gaps:** sidebar comment says Activities, Sales Team, Automation Rules, CRM Reports are not built. Marketing nav lists only "Campaigns" — dashboard/channel/segments/ads are reachable only via `/marketing` page links.
8. Real outbound communication (WhatsApp/email/SMS/telephony) — none.
9. Ads integrations unverified against live Meta/Google APIs.
10. Marketing campaign execution (audiences, templates, sending, landing forms, web-to-lead) — none.

## 9. Important observations for development

- **A 12-slice plan already exists** ("CRM Lead-to-Customer upgrade", branch `crm-lead-to-customer`, plan file `radiant-wiggling-moth.md`). Slices 1–3 are done and merged. Confirmed decisions recorded in `CLAUDE.md` (~line 7425): lightweight CRM Quotation doc; Opportunity = extended `Deal` (no new table); automation on page-load + "Run now" (no background scheduler); new SALES_MANAGER/SALES_EXECUTIVE roles with own-records scoping.
- All stage logic must key on `CrmPipelineStage.kind`, never code/name. Stage moves only through `changeLeadStage()`.
- Activities/follow-ups/history are polymorphic via the shared `RelatedModule` enum — new record types need an enum value (migration).
- RBAC modules/actions live in `config/rbac.ts` and are **seeded**; changing roles means re-seeding permissions.
- `Customer.type` is a plain string and `Customer.country` free text (per earlier audit) — limits segmentation.
- **Local env caveats:** `git status` shows ~1,887 modified files, but ignoring CR/LF and file-mode, only `package-lock.json` really differs; `pnpm-lock.yaml`/`pnpm-workspace.yaml` are untracked (both npm and pnpm lockfiles present). Vitest could not run from the Linux shell (`std-env` export error with the Windows-installed `node_modules`), so tests were **not** executed here. CLAUDE.md claims 2017/2017 passing at slice 1.
- Root audit docs (`CRM_MARKETING_ENHANCEMENT_AUDIT_AND_PLAN.md`, `CRM_SALES_MARKETING_HRMS_MIGRATION_REPORT.md`) predate slices 1–3; parts (e.g. `Lead.status`/`source` enums, "no CRM dashboard") are now outdated.

## 10. Open questions / unknowns

1. Where is `radiant-wiggling-moth.md` (the 12-slice plan)? Not in the repo; slices 4–12 contents are unknown beyond the hints above.
2. Are we continuing that plan, or is the new CRM/Marketing work a different scope?
3. Is `main` the branch to build on? (`origin/crm-lead-to-customer` is fully merged.)
4. Does the running app/DB actually have migrations `20260927…` / `20260928…` applied? Slice 1 notes say it was **not browser-verified**; slices 2–3 verification status is undocumented.
5. Should Opportunities move to configurable stages (`CrmPipeline.OPPORTUNITY`) or keep `DealStage`?
6. Ads integrations: are Meta/Google credentials available for live testing?
7. Any intended WhatsApp/email provider?
8. Is npm or pnpm the canonical package manager?

---

## Removal log (2026-10-01, branch `crm-marketing-rebuild`)

**Deleted (132 files):** `src/modules/crm`, `src/modules/marketing`, `customers/customer-segments.service(.test).ts`, `import/import.service.test.ts`, `components/ui/CsvImportModal.tsx`; pages `/crm`, `/marketing`, `/leads`, `/deals`, `/campaigns`, `/follow-ups`, `/imports`; APIs `crm`, `crm-activities`, `crm-followups`, `marketing`, `leads`, `deals`, `campaigns`, `campaign-alerts`, `campaign-attributions`, `ad-integrations`, `imports`, `customers/segments`, `customers/category-breakdown`, `customers/generate-reengagement-followups`.

**Edited:** sidebar (`navigation.ts`, CRM + Marketing groups removed) · `NotificationBell` (follow-ups link) · Customer 360 (now Buyers, Samples, Sales Orders only) · Sales Orders (`originatingDealId` removed from schema/service/form/page/tests) · Sampling (auto CRM follow-up on "Submitted to Customer" removed) · `import.service.ts` (kept only helpers + batch reads used by Bulk Import) · `import.schema.ts` (CRM import types removed) · `DocumentNumberingService` (LEAD/DEAL/CAMP prefixes).

**Database:** `schema.prisma` — 19 models + 17 enums removed, plus back-relations on Company, Branch, User, Customer, SalesAgent, Category, Season, ProductType, BuyerEnquiry, SalesOrder; values removed from `RelatedModule` (LEAD, DEAL, CRM_FOLLOWUP), `DocumentType` (LEAD, DEAL, CAMPAIGN), `ImportBatchType` (LEAD, DEAL, CAMPAIGN_DAILY_METRIC). New migration `20261001100000_remove_crm_and_marketing` drops the tables/types and deletes rows still using the removed enum values (stops with an error if stock/journal rows reference them).

**Deliberately kept (reusable for the rebuild):** RBAC module keys `crm` / `marketing` and their role grants in `config/rbac.ts`; `core/communication` (messaging provider interface) and `lib/communication.ts` (tel/mailto/WhatsApp links); `core/security/encryption` + `oauth-state`; `NotificationService`; Customers, Buyers, Buyer Enquiries, Sales Agents.

**Verified (in a clean sandbox copy):** all 151 migrations apply to an empty Postgres 16 DB and the seed runs; after the migration the DB tables/enums match `schema.prisma` exactly; `tsc --noEmit` clean; ESLint 0 errors; Vitest 109 files / 2056 tests passing. Not yet run in a browser.
