# CRM Phase 00 — Codebase Discovery & Architecture Assessment

_Date: 2026-10-01 · Branch: `crm-marketing-rebuild-v1` · Read-only phase: no application code changed._
_Inputs: `docs/crm/CRM_MASTER_BLUEPRINT.md`, `docs/crm/CRM_INTEGRATION_AWARENESS.md`, `danishan-understanding.md`._
_Everything below was checked in the code; anything not verified is marked **Unknown**._

---

## 1. The 20-point inventory

| # | Area | What exists (file / model) | CRM implication |
|---|---|---|---|
| 1 | Frontend | Next.js 16.3 App Router, React 19.2, TypeScript, Tailwind v4. No component library; own primitives in `src/components/ui`. | Build CRM UI with existing primitives + Tailwind. |
| 2 | Backend | Next.js route handlers under `src/app/api/v1/**/route.ts`; domain logic in `src/modules/<name>/` (schema → repository → service). Separate BullMQ worker process (`src/core/jobs/worker.ts`). | CRM APIs under `/api/v1/crm/...`; logic in `src/modules/crm/...`. |
| 3 | Database / ORM | PostgreSQL + Prisma 7.9 (`@prisma/adapter-pg`), one `schema.prisma` (~9.6k lines, 217 models after the removal), 151 migrations. | CRM models prefixed `Crm*`, tables `crm_*`; migrations via `prisma migrate`. |
| 4 | Authentication | NextAuth v5 (JWT, 30-day). Session carries `id`, `companyId`, `homeCompanyId`, `defaultBranchId`, `isPlatformAdmin`, `sessionIssuedAt`. `requireSession()` (`src/lib/api-route.ts`) re-checks user status/password change on every API call. Middleware `src/proxy.ts` guards **pages only** (`/api` excluded). | Reuse as-is. Public CRM endpoints later (forms, webhooks, OAuth callbacks) must be explicitly public and signature/token-secured. |
| 5 | Users / employees | `User` (one `companyId`, optional `employeeId` / `contractorId`, `status`). `Employee` is the HR master (department, designation, reportsTo, branch). Login ≠ employee: not every employee has a user. | CRM **owner/assignee = `User`** (the person who logs in and gets notifications); show employee details via `User.employeeId` where present. |
| 6 | Organization / tenant | `Company` (tenant) → `Branch`. Every business table has `companyId`; many have optional `branchId`. Platform admins can switch active company. | Every CRM table gets `companyId` (+ optional `branchId`); all queries scoped by `actor.companyId`. |
| 7 | Roles / permissions | `Role` → `RolePermission` → `Permission(key = module.action)`; users get roles **per branch** (`UserBranchRole`). Catalog in `src/config/rbac.ts` (seeded). `PermissionService.can/assert(userId, module, action)`; platform admin bypass; self-approval guard on approve/post; branch restriction (`getAllowedBranchIds`, `lib/branch-access.ts`). Actions: view, create, edit, delete, approve, reject, post, cancel, export, print (+ a few specials). Module `crm` already exists: MANAGEMENT = view/export, MERCHANDISER = view/create/edit/export/print. | One permission module `crm` for now. **No record-ownership ("my records only") scoping exists** — must be designed if needed (see §6 decision D5). |
| 8 | Customer / company / contact | `Customer` (code, name, `type` free text, country, tax no, addresses, a single `contactPerson`/phone/email, payment terms, credit limit, currency). `Buyer` belongs to a Customer (code, name, contactPerson, email, phone) — in this business a Buyer is typically a **brand/buying entity**, not a person. `BuyerEnquiry` captures prospect name/contact/email/phone/country + source (`EnquirySource`) and lines that convert to Sample Requests. `SalesAgent` = external commission agent. | Customer is the authoritative account master. CRM Company should **link** to it, not copy it. Contacts (people) don't exist as a master today. See conflicts C1–C4. |
| 9 | Products / services | `Product` (`itemType` STYLE / RAW_MATERIAL, variants/SKUs), `Category` (tree), `Season`, `ProductType`, `Brand`, fabric/garment attribute masters. | Opportunities/leads reference these masters (interest, category, season) — never copy. |
| 10 | Quotation / order / invoice | **No quotation module.** `SalesOrder` (DRAFT→…→CLOSED), `SalesInvoice`, `CustomInvoice`, `Payment` (RECEIPT / PAYMENT_OUT), `Dispatch`. `SampleRequest` lifecycle (REQUESTED → … → SUBMITTED_TO_CUSTOMER → APPROVED). | Opportunity ↔ Sales Order / Sample Request links are possible. "Quotation reference" (Phases 06, 21) is **blocked** until a quotation exists — see D6. |
| 11 | Tasks / activities | **None in the ERP** (the old CRM activities/follow-ups were removed). | CRM builds tasks/activities (Phase 09). |
| 12 | Notifications | `Notification` table (in-app; `channel` enum IN_APP/EMAIL/SMS — only IN_APP used), `NotificationService` (create, list, unread count, mark read), `NotificationBell` in the top bar. No link/URL field; points to a record via `relatedModule` + `relatedRecordId`. | Reuse for reminders/assignments. Adding CRM record types means adding `RelatedModule` values (enum migration). |
| 13 | Files / documents | `AttachmentService` (upload/list/download/delete, MIME + size checks, company-scoped) over `FileStorage` (local disk, `FILE_STORAGE_ROOT`). Polymorphic via `RelatedModule`. | Reuse for lead/contact/opportunity files. |
| 14 | Audit / logging | `writeAuditLog({ companyId, userId, tableName, recordId, action, oldValues, newValues })` → `AuditLog` (append-only, called inside the mutation's transaction). Structured JSON logger + per-request correlation ID (`core/logging`). | Every CRM mutation calls `writeAuditLog`. The user-facing timeline is a separate CRM concern (see §4). |
| 15 | Background jobs | BullMQ + ioredis, **one queue** (bulk master-data import), separate worker process started by `npm run dev`. Redis = remote Redis Cloud (`REDIS_URL`). | Imports, bulk actions, sequences, workflow waits will add queues. Redis availability becomes a runtime dependency (D8). |
| 16 | API conventions | `requireSession()` → `PermissionService.assert()` → Zod `.parse()` → service(`actor`, input) → `NextResponse.json({ data })` or `{ data, meta }`; errors via `handleApiError` + `BusinessRuleError(code)` → HTTP status map. Lists: `parseListQuery` (`page`, `pageSize`, `search`, `sortBy`, `sortOrder`, `status`) + `buildListMeta`. Business operations = sub-resource POST (`/:id/convert`), not generic status PATCH. Toast via `x-toast` headers read by `api-client.ts`. | Follow exactly. |
| 17 | Design system | `DESIGN_SYSTEM.md`, `UI_RULES.md`, `COMPONENT_GUIDELINES.md`, `COMMON_FEATURES.md`: zinc/indigo palette, dark-mode classes, spacing/radius scale, empty/loading/error rules, "Server Component page + Client panel" split, `key={id}` rule. | Follow; CRM shared components go in `src/components/crm/` only when reused across CRM pages. |
| 18 | Routing / navigation | Route group `src/app/(dashboard)`, shell `DashboardShell` / `Sidebar` / `Topbar`; sidebar config `src/components/layout/navigation.ts` (items filtered by viewable RBAC modules). Breadcrumb component. Company-level "submodule visibility" exists only for masters tabs. | Re-add a "CRM" sidebar group in Phase 01; all pages under `/crm/...`. |
| 19 | Search / filter | Per-list: `DataTable` (server fetch, search box, one `statusFilter`, sortable columns, pagination, Excel export link, row actions). Global search: `modules/search/global-search.service.ts` with a per-entity registry (`SEARCH_ENTITIES`). **No** saved views, advanced/multi-condition filters or column selection. | Phase 01 shared CRM table/filter must extend (not fork) DataTable; CRM entities register in global search; Smart Lists (Phase 13) build the query engine. |
| 20 | Integration / webhook | **No webhook, event bus or integration framework.** Reusable pieces: `core/security/encryption` (secrets at rest), `core/security/oauth-state` (signed OAuth state), AI provider manager (DB-stored encrypted credentials + failover = good adapter precedent), `core/communication/CommunicationProvider` (manual no-op), `lib/communication.ts` (tel/mailto/wa.me), login rate limiter (in-memory). Removed Meta/Google Ads OAuth code is in git history on `main`. | Integration layer built per phase per `CRM_INTEGRATION_AWARENESS.md`. Phase 01 needs **no** external integration. |

---

## 2. Reusable components & services

**Services (`src/core`, `src/lib`):** `requireSession` / `handleApiError` · `PermissionService` · `branch-access` · `BusinessRuleError` · `writeAuditLog` · `generateDocumentNumber` (human numbers per `DocumentType`) · `NotificationService` · `AttachmentService` / `FileStorage` · BullMQ `queue.ts` / `worker.ts` · `encryption`, `oauth-state` · AI `provider-manager` (`runWithFailover`) · `CommunicationProvider` · `core/reports` (csv / excel / pdf) · `lib`: `list-query`, `api-client`, `validation` (phone etc.), `money`, `currency`, `country-currency`, `countries`, `date`, `date-format`, `csv`, `xlsx`, `humanize-status`, `use-action-display`.

**UI (`src/components`):** `DataTable`, `SearchableSelect`, `FormField`, `Button`, `Modal`, `ConfirmModal`, `ChildFormModal`, `Toast`, `Breadcrumb`, `ActionMenu` / `RowAction`, `ToggleSwitch`, `FilePreviewModal`, `SimpleLookupManager` (good for CRM settings masters: statuses, sources, tags), `ClientDateTime`, `icons`; `components/reports/*` (`ReportPage`, `ReportFilterBar`, `ReportTable`); layout `NotificationBell`, `GlobalSearch`.

**Patterns:** `makeSimpleLookupService()` factory (garment-attributes) for simple CRM masters; bulk-import pipeline (`modules/import/bulk-import.service.ts`: xlsx/csv parse, async job, per-row errors, `ImportBatch` / `ImportBatchRecord`) for Phase 03.

**Not available (must be added when a phase needs it):** drag-and-drop, calendar view, chart library (old charts were hand-drawn SVG), workflow canvas, rich-text editor, HTML email rendering, E2E test runner.

---

## 3. Entities: reference vs. create

**CRM references (never copies):** `Company` (tenant), `Branch`, `User` (owner/assignee/creator), `Employee` (via `User.employeeId`), `Customer`, `Buyer`, `BuyerEnquiry`, `SampleRequest`, `SalesOrder`, `SalesInvoice`, `Payment`, `Product`, `Category`, `Season`, `ProductType`, `Attachment`, `Notification`, `AuditLog`.

**CRM creates (by phase):** Lead (02) · CRM Company/Account (05, link to `Customer`) · Contact (04) · Opportunity (06) · Pipeline / Stage / StageHistory (07) · Task / Activity (09) · Appointment (10) · Conversation / Message / Channel connection (11) · Template (12) · SmartList / SavedView (13) · BulkJob (14) · CustomFieldDefinition (15) · Form / FormField / FormSubmission (16) · Sequence / Step / Enrollment (17) · Workflow / Node / Execution (18) · ScoringRule / ScoreHistory (20) · StageTransitionRule (21) · Campaign (22) · CustomObject / Record (26) · Integration connection / log, webhook endpoint / delivery (as phases require) · settings masters: lead status, lead source, tag, duplicate rule (02/30) · **CRM event/timeline log (01)**.

---

## 4. Database relationship recommendations

1. **Tenant columns:** every CRM table has `companyId` (FK `Company`), optional `branchId`; composite indexes start with `companyId`. Every by-id lookup uses `findFirst({ where: { id, companyId } })` (COMMON_FEATURES §5, enforced by `company-scoping.contract.test.ts`).
2. **People:** `ownerUserId`, `createdByUserId`, `updatedByUserId` → `User`. Do not reference `Employee` directly for ownership.
3. **Account ↔ Customer:** `CrmCompany.customerId` nullable `@unique` → `Customer`. A prospect company has no Customer; on "won / convert to customer" the CRM creates or links the ERP Customer and stores the link. ERP fields (tax no, credit limit, terms) stay on `Customer`.
4. **Lead lifecycle (Zoho-style):** Lead is a standalone record; conversion creates/links Contact + CRM Company (+ optional Opportunity) and stores `convertedContactId` / `convertedCompanyId` / `convertedOpportunityId` / `convertedAt`. Optional `buyerEnquiryId` link (D3).
5. **Polymorphic CRM links:** a CRM-owned enum `CrmEntityType` (LEAD, CONTACT, COMPANY, OPPORTUNITY, … extended per phase) + `entityId` for timeline, tags, notes, tasks, custom-field values. Where an ERP-wide service needs it (attachments, notifications), add matching `RelatedModule` values in the same migration.
6. **Timeline + events — one append-only table from Phase 01:** `CrmEvent { id, companyId, entityType, entityId, eventType ("lead.created", "opportunity.stage_changed", …), actorUserId, occurredAt, payload JSON, correlationId }`. It serves three later needs: record timelines, workflow triggers (Phase 18) and outbound webhooks (Phase 29) as an outbox. `AuditLog` stays the compliance trail; `CrmEvent` is the business timeline.
7. **Custom fields:** reserve a `customFields Json` column on Lead / Contact / Company / Opportunity from their first migration; definitions + validation arrive in Phase 15 (GIN index when filtering is added in Phase 13).
8. **Tags:** `CrmTag` master + `CrmEntityTag(entityType, entityId, tagId)` join, unique per entity/tag.
9. **Archive, not delete:** `archivedAt` / `archivedByUserId`; hard delete only for draft/erroneous data with permission `crm.delete`.
10. **Money:** `Decimal(15,2)` + `currencyCode Char(3)`, default to the company base currency.
11. **Human numbers:** add `DocumentType` values (e.g. `CRM_LEAD`, `CRM_OPPORTUNITY`) and use `generateDocumentNumber`.

---

## 5. Recommended module structure

```
src/modules/crm/
  core/            events (CrmEvent writer + typed event names), timeline reader, entity-type registry, shared zod helpers
  leads/           lead.schema.ts · lead.repository.ts · lead.service.ts · *.test.ts
  contacts/  companies/  opportunities/  pipelines/  activities/ …   (one folder per phase, same 3-file pattern)
  integrations/    adapter interfaces + providers (only when a phase needs one)
src/app/(dashboard)/crm/
  page.tsx (dashboard)  layout.tsx (CRM sub-header, optional)  leads/  contacts/  companies/  opportunities/  settings/ …
src/app/api/v1/crm/<resource>/...route.ts
src/components/crm/    CRM-shared UI (record header, timeline, filter bar) — only when used by 2+ CRM pages
```

Nested folders are allowed in this codebase (precedent: `modules/marketing/ad-integrations` before removal). Permission module stays `crm`; finer modules (`crm_settings`, `crm_automation`, …) can be split later, as the RBAC audit already did for other areas.

---

## 6. Potential conflicts & decisions needed

| ID | Topic | Finding | Recommendation |
|---|---|---|---|
| C1 / D1 | CRM Company vs Customer | Customer is the authoritative master and also holds a single contact. | CRM Company = relationship record, links to Customer (nullable unique). Existing Customers can be linked/imported on demand. |
| C2 / D2 | Contact vs Buyer | Buyer = brand/buying entity under a Customer with contact fields, not a person master. | CRM Contact = a person (new). Optional `buyerId` on Contact/Opportunity to say which brand they buy for. Customer/Buyer stay untouched. |
| C3 / D3 | Lead vs Buyer Enquiry | Buyer Enquiry already captures prospect details and drives sampling. | Keep Buyer Enquiry as the merchandising document. A Lead (or Opportunity) can create / link an enquiry; no duplication of enquiry lines in CRM. |
| C4 | Owner vs Sales Agent | Sales Agent = external commission agent, not a login. | Owner = User; optional `salesAgentId` on Opportunity for commission attribution. |
| D5 | Record visibility | Permissions are per module only. | Decide now: (a) everyone with `crm.view` sees all CRM records, or (b) add "own / team / all" scope (needs a small addition to RBAC, e.g. an action like `crm.view_all`). Recommend (b), designed in Phase 01, applied from Phase 02. |
| D6 | Quotations | No ERP quotation module; blueprint says ERP owns quotations. | Either build a minimal ERP Quotation module later (outside CRM) or let the opportunity hold a quotation document reference/attachment until then. Needed by Phase 06/21. |
| C5 | Public endpoints | Middleware protects pages only; `/api` is open by design and each route self-checks. CSP has `frame-ancestors 'none'` + `X-Frame-Options: DENY`. | Public forms (Phase 16) need a route exception for embedding; webhooks (Phase 03/29) need signature verification + rate limiting. |
| C6 / D8 | Redis dependency | Remote Redis Cloud, one queue today. | Confirm a Redis instance you control before Phase 03 (imports) / 14 / 17 / 18. |
| C7 | Enum migrations | Adding `RelatedModule` / `DocumentType` values requires migrations. | Bundle the needed values into each phase's migration. |
| C8 | Notifications have no deep link | Only `relatedModule` + id. | Map CRM entity types to URLs in the bell, or add a nullable `linkUrl` column (small ERP-wide change) in Phase 09. |
| C9 | Repo hygiene | ~1,900 files show as modified from the Linux side (CRLF / mode), and both npm and pnpm lockfiles exist. | Commit from Windows; pick npm (CI uses npm) and drop the pnpm files. |
| D9 | Industry neutrality vs garment focus | Blueprint wants industry-neutral; this ERP is garment-specific. | Neutral core + configurable fields; garment specifics (category, season, MOQ, target price, sampling) as optional fields/links, not hard-coded logic. |

---

## 7. Conventions to follow

**API:** `/api/v1/crm/...`; `requireSession` → `PermissionService.assert(userId, "crm", action)` → Zod → service(actor) → `{ data }` / `{ data, meta }`; `BusinessRuleError` codes (`NOT_FOUND`, `VALIDATION_ERROR`, `PERMISSION_DENIED`, duplicates…); list params via `parseListQuery`; business ops as sub-resource POSTs; services never import `prisma` directly (repository only); audit inside the same transaction.

**Frontend:** Server Component page loads data through the service, Client Component panels for interactivity with `key={id}`; `DataTable` for lists; `FormField` + `SearchableSelect` for forms; `Modal` / `ConfirmModal` with a visible Cancel; toasts via `api-client`; Breadcrumb on every page; empty / loading / error states per `UI_RULES.md`; dark-mode classes; `formatDate` / money helpers (no unpinned locale formatting — hydration rule).

**Testing:** Vitest (node env). Service tests mock the repository + core services with `vi.mock` and dynamic `await import`. UI tests use `// @vitest-environment jsdom` + Testing Library. `company-scoping.contract.test.ts` automatically checks every `update*` / `transition*` service function references `actor.companyId`. No DB-backed API tests and no E2E runner today. Per phase: service unit tests, route tests (mocked service), component tests for key UI, migration applied to a fresh DB + seed, full suite, then manual UI checklist. Propose Playwright E2E at Phase 36 (or earlier if wanted).

---

## 8. Integration check for Phase 00 / 01

Per `CRM_INTEGRATION_AWARENESS.md`: Phase 00 is read-only; Phase 01 (foundation) needs **no external integration**. Phase 01 should only lay the `CrmEvent` table + typed event names so later phases (workflows, webhooks, connectors) consume the same events.

---

## 9. Proposed Phase 01 scope (for confirmation)

CRM sidebar group + `/crm` route + layout and dashboard shell · CRM shared components (record header, timeline, filter bar extending `DataTable`, empty / loading / error patterns) · `/api/v1/crm` namespace helpers · `CrmEvent` table + event writer · `CrmEntityType` enum · audit helper wrapper · record-visibility design (D5) · tests. No Leads / Contacts / Opportunities yet.

## 10. Unknowns

- Contents of the abandoned 12-slice plan file (`radiant-wiggling-moth.md`) — irrelevant now, but not found.
- Whether production will keep Redis Cloud or self-host Redis.
- Which external providers (WhatsApp BSP, SMS, telephony) the business will actually use.
- Expected data volume per company (affects indexing choices in Phases 02 and 13).
- Whether a Quotation module is planned outside CRM.
