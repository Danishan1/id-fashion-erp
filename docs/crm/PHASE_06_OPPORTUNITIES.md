# CRM Phase 06 — Opportunities: Report & Test Checklist

Branch on your machine: `crm-build-v2` (Phase 05 committed as `eefd483`). Phase 06 files are written to the repo, **not committed**.

## What existed before this phase

- **`crm_opportunities` (Phase 02):** number, name, lead, contact, company, source, owner, status enum (Open / Won / Lost / Abandoned), amount, currency, expected close, description, custom fields, archive. Opportunities were only created by lead conversion and had no pages.
- **Not in the ERP:**
  - pipelines / stages
  - an activity or task system (Phase 09)
  - **any quotation module** (the closest documents are buyer enquiries, sample requests with costing, and sales orders)

## Decisions applied (change any of them after testing)

| Topic | Decision |
|---|---|
| Model | The Phase 02 table is extended, not replaced. `value` = `amount` + `currency_code`, never overwritten from ERP documents. Company only, contact only, or both. Many opportunities per company / contact / lead. |
| Pipeline / stage | Minimum only: `crm_pipelines` + `crm_pipeline_stages` with a lazily created default **Sales** pipeline (New 10 % · Qualified 25 % · Proposal 50 % · Negotiation 75 % · Closing 90 %). There is a read-only API for pickers and **no management UI** (that is Phase 07). Existing opportunities are back-filled into **New**. |
| Probability | 0–100 whole numbers (validated in the API and by a DB CHECK). Entering a stage applies its default probability **unless** the user had set their own (it no longer equals the old stage's default); an explicit value always wins. There is no AI. |
| Status | The existing enum stays (Phase 02 code depends on it) and is the extension point. Open → Won / Lost / Abandoned stores `closed_at`, who closed it, and an optional reason (configurable suggestions under Settings → Form options → Win / loss reasons). A closed opportunity can't be edited or moved between stages until it is **Reopened** (→ Open, audited, clears the close fields). Owner, tags, notes and documents can still change on closed deals. A past expected-close date never closes anything automatically. |
| Quotations | No CRM quotation is invented. A generic **ERP document link** (`crm_opportunity_erp_links`, many per opportunity) references **buyer enquiries, sample requests and sales orders**. Only the document's id and number are stored; date, status, amount and customer are read live from the ERP. A future ERP Quotation module plugs in as one more provider (no migration). Until then the Quotation section says the ERP has none. |
| Activities / Tasks | Honest placeholders (Phase 09). No separate opportunity engine. |
| Duplicates | Warn only: another **open**, non-archived opportunity with the same name (ignoring case / spacing) for the same company **and** contact → 409 with matches + **Save anyway**. Closed ones, other contacts or other companies don't count. Never blocks. |
| Visibility | Same rule as other CRM records (own + created-and-unassigned, or `crm.view_all`). Linking a company / contact / lead requires seeing it. A contact you can't see shows by name only (no email / phone). |

## Files

**New**

- `prisma/migrations/20261005100000_crm_opportunities/migration.sql`
- `src/modules/crm/pipelines/`: `crm-pipeline.repository.ts`, `crm-pipelines.service.ts` (default pipeline, list, validation; Phase 07 extends this)
- `src/modules/crm/opportunities/`:
  - `opportunity-registry.ts` (statuses, transitions, default pipeline, ERP document types, close-reason list, later-phase sections)
  - `opportunity.schema.ts`
  - `opportunity-filters.ts`
  - `crm-opportunity-erp.service.ts`
  - `opportunities.unit.test.ts`, `opportunity.integration.test.ts`
- `src/app/api/v1/crm/opportunities/**` (16 route files + `route.test.ts`), `src/app/api/v1/crm/pipelines/route.ts`
- `src/app/(dashboard)/crm/opportunities/`:
  - list, `new`, `[id]`, `[id]/edit` pages
  - `_components`: `OpportunitiesListClient`, `OpportunityForm`, `OpportunityDetailClient`, `OpportunityDialogs`, `OpportunityRelatedPanels`, `OpportunityBadges`, `opportunity-types`, `useOpportunityLookups`, `opportunity-components.test.tsx`
- `src/components/crm/CrmRecordPicker.tsx` (reusable server-search company / contact selector)
- `docs/crm/PHASE_06_OPPORTUNITIES.md`

**Modified**

- `prisma/schema.prisma`
- **Opportunities:** `crm-opportunities.service.ts` and `crm-opportunity.repository.ts` (Phase 02 surface kept)
- **Core and shared CRM:**
  - `core/crm-event-types.ts`, `core/crm-entity-types.ts`, `core/crm-mutation.ts` (last-activity bump), `core/crm-dates.ts`
  - `documents/crm-documents.service.ts`, `erp/crm-erp.repository.ts`
  - `saved-views/crm-saved-views.service.ts`, `settings/crm-settings.schema.ts`
- **Companies and contacts:**
  - `contacts/contact-registry.ts`, `contacts/crm-contact.repository.ts`
  - `companies/crm-company.repository.ts`, `companies/company-relations.service.ts`
- **UI cross-links:**
  - company detail + related panel
  - contact detail + related panel
  - lead detail
  - navigation (+ test)
  - CRM settings page / client / custom-fields tab / options tab, custom-fields route
- **Tests updated:** company integration test (stage now present), entity registry test (opportunity href).

## Database (additive only)

- **`crm_opportunities` gains:**
  - `name_key`, `pipeline_id`, `stage_id`, `stage_changed_at`, `probability` (CHECK 0–100)
  - `closed_at`, `closed_by_user_id`, `close_reason`
  - `search_text`, `last_activity_at`, `archived_by_user_id`, `updated_by_user_id`, `version`
- **Indexes on `crm_opportunities` (8):** company + archived / created, company, contact, pipeline + stage, owner, expected close, last activity, name key.
- **New tables:**
  - `crm_pipelines` (unique company + key)
  - `crm_pipeline_stages` (unique pipeline + key, CHECK on probability)
  - `crm_opportunity_erp_links` (unique opportunity + type + document)
- `RelatedModule` gains `CRM_OPPORTUNITY` (attachments).
- **Back-fill:** default pipeline for tenants with opportunities; existing ones → New stage + its probability; name key, search text, `closed_at` for already closed ones, last activity.
- **No ERP table is altered.**

## Entities reused

- **ERP:** `User` (owner); RBAC (`crm`, `crm_settings`, plus `buyer_enquiries` / `sampling` / `sales_orders` view for ERP documents); branch access; `AuditLog`; `Attachment` service; `DocumentSequence` (OPP numbers); `Customer` / `BuyerEnquiry` / `SampleRequest` / `SalesOrder` (read-only).
- **CRM:**
  - Records: Phase 05 Company, Phase 04 Contact, Phase 02 Lead, sources
  - Shared engines: tags, notes, custom-field engine (`OPPORTUNITY`), saved views, events / timeline, `runCrmMutation`
  - UI: list, filter, bulk and dialog components

## API (`/api/v1/crm/…`, all through `crmRoute`: auth, permission, tenant, validation, error mapping)

| Method + path | Purpose |
|---|---|
| `GET/POST opportunities` | List (search, filters, sort, paging) / create (409 duplicate warning) |
| `GET opportunities/meta` | Pipelines + stages, statuses, sources, custom fields, close reasons, base currency |
| `POST opportunities/duplicate-check` | Live warning |
| `POST opportunities/bulk` | assign / stage / status / addTags / removeTags / archive (≤500, skipped reasons) |
| `GET/PATCH opportunities/:id` | Detail / edit (open only, optimistic `version`) |
| `POST opportunities/:id/assign`, `stage`, `status`, `tags`, `archive`, `restore` | Focused actions (all audited + timeline) |
| `GET/POST opportunities/:id/notes`, `documents` | Notes, attachments (download/delete via `/crm/documents/:id`) |
| `GET/POST opportunities/:id/erp-documents`, `GET …/search`, `DELETE …/:linkId` | ERP references: list live, search the customer's documents, link, unlink |
| `GET pipelines` | Read-only pipelines with stages |
| `GET events?entityType=OPPORTUNITY&entityId=…` | Timeline (existing endpoint, access-checked) |

## ERP references

- **Document must belong to the customer:** a document can be linked only if the user has that ERP module's view permission and branch access, and, when the opportunity's company is linked to an ERP customer, the document belongs to **that** customer.
- **Without a customer link:** the picker requires typing a document number.
- **Users without the module:** they see the reference count but no ERP data.
- **Nothing is written to ERP tables.** Tests verify that the sales order row and the customer row are unchanged.

## Search, filters, performance

- **Search (server-side):**
  - opportunity name / number / linked ERP document numbers (stored search text)
  - company search keys (name, legal name, website, email, phone, city, ERP customer code)
  - contact search keys (name, emails, phones)
  - phone digits; exact id
- **Filters:** pipeline, stage, status, owner / unassigned, company, contact, source, tag, origin (from lead), *Closing* (overdue / next 7 / next 30 days / this month — open deals, India business day), expected-close / created / updated ranges, value range, probability range, archived. All are combinable and stored by saved views.
- **Sorting:** name, value, probability, expected close, stage order, last activity, created, updated.
- **Performance:**
  - Indexed columns; list = `count` + `findMany` in parallel + one tag query per page.
  - Related sections (notes, documents, ERP references, timeline) load separately and lazily.
  - No N+1 queries.

## Tests

- **Vitest:**
  - Without a DB: 143 files; **2,291 passing**, 75 DB tests skipped.
  - With `CRM_IT_DATABASE_URL`: **2,366 / 2,366 passing**.
- **Opportunity integration suite** (13 tests, real Postgres; rerunnable):
  - **Create:** default pipeline / stage / probability, keys, tags, audit, events on company and contact.
  - **Associations:** company-only / contact-only / both; multiple opportunities per company and contact; invisible company refused.
  - **Duplicates:** warn → confirm; closed / other-contact deals don't count.
  - **Stage changes:** timeline + audit with old / new stage and probability; manual probability kept; 0 / 100 accepted, −1 / 101 / unknown stage rejected.
  - **Won / Lost / Abandoned:** `closed_at` + reason, edits blocked, wrong transitions refused, reopen.
  - **Change events:** value / close date / company / contact / owner events; version conflict; OWN visibility.
  - **Search and filters:** company, contact email, phone digits, number, ERP document number; value / probability / date filters; sort + paging.
  - **ERP links:** two sales orders + an enquiry; duplicate link, other customer's document, missing document and the QUOTATION type all refused; live amounts with the value never overwritten; no access → hidden + refused; unlink.
  - **From a lead:** keeps lead + source; several deals from one lead; lead conversion lands in New.
  - **Archive / restore, notes, documents, timeline:** history and documents kept, access guarded.
  - **Custom fields, tags, saved views:** validation and filtering.
  - **Bulk actions:** skipped reasons.
  - **No side effects:** ERP customer and CRM company rows unchanged.
- **Unit tests (15):** probability / value / currency validation, strict update, filters (round trip, scoping, search, closing shortcuts in IST, ranges, sort), status transitions, stage-probability rule, search text.
- **Route tests (6):** permissions per action, 400 / 403 / 404 / 409 passthrough, ERP search params, pipelines.
- **Component tests (7):** status badge / overdue, reopen-only for closed deals, close with reason, stage default probability, already-linked ERP documents disabled.
- **Regression:** the Phase 02–05 suites pass unchanged except the two expected updates listed above.
- **Static checks:** `tsc` is clean. ESLint has 0 errors (the same 12 pre-existing warnings, none in CRM).
- **Migrations:**
  - All **157** apply to an empty DB, the seed runs, and the schema matches.
  - The Phase 05 database with data upgrades in one pass: an existing converted opportunity got the Sales / New stage at 10 % and its keys.
- **Browser test** (fresh seeded DB; a test sales order inserted for CUST002):
  - company linked to the ERP customer + contact
  - **+ New opportunity** from the contact (company and contact prefilled) → create
  - duplicate warning → Save anyway shown
  - stage → Proposal (50 %, weighted value)
  - link SO-E2E-0001 (live EUR 18,500, customer)
  - Mark won with reason (Edit hidden) → Reopen
  - timeline shows every step
  - list search by SO number and filters
  - company page lists the deal
  - settings tab
  - ERP customer checksum unchanged; only console error is the expected 409.

## Manual test checklist (your machine)

```powershell
npx prisma generate
npx prisma migrate deploy        # applies 20261005100000_crm_opportunities
npm test
npm run dev
```

1. **CRM → Opportunities.** Opportunities from earlier lead conversions are listed in stage *New* at 10 %.
2. **From a company:** open a company → Opportunities → **+ New opportunity** (company and primary contact prefilled). Enter name, value, expected close, description and a tag → Create.
3. **From a contact:** Related records → **+ New opportunity** (contact and company prefilled). **From a lead:** ⋮ → **Create opportunity** (lead and source kept, "From lead" in Record).
4. **Duplicate warning:** create another with the same name for the same company and contact → warning → **Save anyway** works. A different contact gives no warning.
5. **On the opportunity:**
   - ⋮ → **Change stage** (probability follows the stage unless you typed your own).
   - **Edit** (value, close date, company / contact).
   - **Mark won / lost / abandoned** with a reason: Edit disappears, **Reopen** brings it back.
   - The timeline shows each change with before / after.
6. **Quotation & ERP documents → + Link:** pick a sales order / buyer enquiry / sample request of the linked customer. Live date, status and amount show; the opportunity value doesn't change. Search the list by that document number. **Unlink.**
7. **Notes and attachments:** add a note, upload a PDF, archive / restore (all kept).
8. **List:**
   - Search by company, contact email, phone, OPP number.
   - Filters: Stage, Status, Owner, Company, Contact, Closing = Next 30 days, Value range, Probability range, Expected close.
   - Sort by value / expected close / stage; columns.
   - **Save as view.**
   - **Bulk:** Assign / Change stage / Change status / Tags / Archive (skipped reasons shown).
9. **Settings:** **Opportunity custom fields** (add one, see it on the form and detail); **Form options → Win / loss reasons.**
10. **As a rep without `crm.view_all`:** only own / created opportunities; another rep's URL gives 404; you can't pick a company or contact you can't see. Without Sales Orders view: the ERP section says "no access" and linking a sales order is refused.
11. **Regression:** Leads (create, convert with opportunity), Contacts, Companies (opportunity list now links to the deal), Sales Orders / Customers unchanged.

## Known limitations

- **Pipelines are fixed** to the default Sales pipeline (read-only). Adding pipelines / stages, reordering, stage rules and the board are Phases 07–08. The data model already supports several pipelines.
- **The ERP has no quotations.** Buyer enquiries, sample requests and sales orders can be referenced; the quotation section is a placeholder.
- **Activities, tasks, appointments and conversations** arrive in Phases 09–11. The timeline already records every CRM change.
- **Statuses are the four built-in ones** (enum). Configurable close reasons exist; adding a status value is a small migration plus a registry entry.
- **No opportunity merge.** Several deals per customer are legitimate; duplicates are warned about, not merged.
- **The list's Company / Contact filters** offer the first 200 records; any id can be passed via the URL (the company / contact pages link that way).
- **No forecasting or weighted-pipeline reports** (Phase 23). The detail page shows the weighted value only.

## Extension points

- **Phase 07:** extend `src/modules/crm/pipelines/` (CRUD, ordering, stage probability / rules); `resolvePipelineStage` is the single validation point; `stage_changed` events carry the full history.
- **ERP quotations:** add a `QUOTATION` provider in `crm-opportunity-erp.service.ts` and an `ERP_DOC_TYPES` entry.
- **Phase 09 (activities / tasks):** replace the `OPPORTUNITY_FUTURE_SECTIONS` entries. `runCrmMutation` already bumps `last_activity_at` for opportunity events.
- **Workflows (Phase 18):** consume the `opportunity.*` events (created, updated, stage_changed, won, lost, abandoned, reopened, owner_changed, company_linked / contact_linked, value / probability / close_date_changed, tag_*, note_*, document_*, erp_document_linked / unlinked, archived / restored).
- **Smart Lists (Phase 13):** `opportunityFilterSchema` is stored unchanged by saved views.

## Assumptions

- **Value** = estimated CRM value in a 3-letter currency (default: the company's base currency when only a value is entered).
- **Closing a deal** doesn't change probability or the company's status. No automatic Won → customer creation; ERP customer creation stays in Masters.
- **ERP document access** is governed by `buyer_enquiries.view` / `sampling.view` / `sales_orders.view` plus branch access.

## CLAUDE.md entry (appended on your machine)

```markdown
## CRM rebuild — Phase 06 Opportunities (2026-10-04)
- All opportunity writes go through `src/modules/crm/opportunities/crm-opportunities.service.ts` (creation always via `createOpportunityInMutation`: number, default pipeline/stage, keys, audit, events). Value = `amount`+`currency_code`, never overwritten from ERP documents.
- Pipelines/stages: minimal `crm_pipelines` / `crm_pipeline_stages` with a lazily created default "Sales" pipeline (`src/modules/crm/pipelines/`); no management UI until Phase 07. Validate with `resolvePipelineStage`; stage changes always emit `opportunity.stage_changed` with old/new stage + probability.
- Status: enum OPEN/WON/LOST/ABANDONED; transitions in `opportunity-registry.ts` (open closes any way; closed only reopens). Closing sets closed_at/closed_by/close_reason; closed deals can't be edited until reopened.
- ERP documents: `crm_opportunity_erp_links` (many per opportunity, id+number only, live ERP data, per-module permission + branch scope, must match the company's ERP customer). The ERP has no quotations — add a provider in `crm-opportunity-erp.service.ts` when it does. Never write ERP tables from CRM code.
- Duplicate check is warn-only (same name + company + contact, open).
- Report: `docs/crm/PHASE_06_OPPORTUNITIES.md`.
```
