# CRM Phase 05 — Companies / Accounts: Report & Test Checklist

Branch on your machine: `crm-build-v2`. Phase 05 files are written to the repo, **not committed**.

## Decisions applied

| Topic | Decision |
|---|---|
| Organisation master | The ERP `Customer` stays the **only customer master**. `crm_companies` is the CRM's account record for prospects *and* customers and **references** the customer through the existing unique `customer_id` (one ERP customer ↔ at most one CRM company). Balances, invoices, orders, credit limits and addresses are never copied; the CRM never creates, edits or deletes a customer. |
| Status | Configurable per tenant (`crm_company_statuses`, CRM Settings → Company statuses). Defaults: Prospect (default), Active prospect, Customer, Partner, Inactive, Former customer, Lost. They are created lazily, like lead statuses. The migration gives existing companies an initial status (linked to a customer → Customer, otherwise Prospect). After that, status is a CRM choice; ERP events never change it. |
| Owner | ERP users. An inactive owner stays visible as "(inactive)" and can be reassigned. Every owner change is an event plus an audit row. |
| Source | Reuses `crm_lead_sources` (default Manual). Lead conversion copies the lead's source and sets `source_lead_id`. |
| Contacts | A contact keeps **one** company (`crm_contacts.crm_company_id`, as in Phase 04). The company has an optional **primary contact**. Adding a contact that is at another company needs an explicit "move" confirmation. Contacts are never duplicated or created implicitly. |
| Duplicate rules | Name (ignoring case, punctuation, "The", Pvt / Ltd / LLP / Inc… suffixes), legal name (compared both ways with names), website domain, email, phone / mobile. Each can be set to Warn / Block / Flag / Allow; all default to **Warn**. **Same ERP customer is always Block** (database unique key). Nothing is ever auto-merged. |
| Merge | Pairwise, needs `crm.edit` plus visibility of both companies. Every conflicting value must be chosen explicitly. **Companies linked to different ERP customers can't be merged** (resolve it in the ERP first). Only one ERP link is ever kept. Nothing is deleted. |
| ERP linking | Only an **existing, non-deleted** customer, by a user with customer access (`masters_core.view` or `sales_orders.view`), and only if it isn't linked to another CRM company. Audited and on the timeline. Unlinking doesn't touch the customer. |
| Quotations / tickets | The ERP has **no quotation or ticket module**. The company page says so explicitly (no fake data). ERP references show buyer enquiries, sales orders, sales invoices and receipts. |
| Activities | Activities, appointments and conversations don't exist yet (Phases 09–11). The page shows honest placeholders; the timeline shows every CRM event (optionally including the company's contacts and leads). |

## Architecture

```
src/modules/crm/companies/
  company-registry.ts          client-safe: default statuses, duplicate rule labels/defaults, option lists, later-phase sections
  company.schema.ts            zod (client-safe): create/update (strict), link/assign/status, filter (+parse/toParams), sort, bulk, merge
  company-keys.ts              pure: name match key, website key/normalise, derived keys + search text (parity with the SQL back-fill)
  company-duplicates.ts        pure rule evaluation + one indexed candidate query + enforcement
  company-filters.ts           the one CompanyFilter → Prisma where/orderBy (tenant + visibility + not merged)
  crm-company.repository.ts    all company data access (list/detail/raw/versioned/locks/related pages/counts)
  crm-companies.service.ts     create/update/assign/status/tags/archive/restore/duplicates/ERP link/addresses/bulk
                               + Phase 02–04 surface (createCrmCompanyInMutation, findOrCreateCrmCompanyForCustomer…)
  company-relations.service.ts paged contacts/leads/opportunities, add/remove contact, primary contact, link/unlink lead, ERP refs
  company-merge.service.ts     preview + transactional merge
src/modules/crm/erp/           CrmErpRepository + crm-erp-references.service (shared by contacts and companies)
src/modules/crm/documents/     crm-documents.service (CONTACT + COMPANY over the ERP attachment service)
src/components/crm/            CrmDocumentsPanel, CrmErpReferencesPanel, CrmRecordDialogs (shared by contacts + companies)
src/app/(dashboard)/crm/companies/  list, new, [id], [id]/edit, merge + _components
```

### ERP entities reused (nothing duplicated)

- `Customer` (referenced through `crm_companies.customer_id`; read-only)
- `BuyerEnquiry`, `SalesOrder`, `SalesInvoice`, `Payment` (read-only references, per-module permission and branch scope)
- `User` (owners)
- RBAC: `crm`, `crm_settings`, `masters_core`, `sales_orders`, `buyer_enquiries`, `invoices`, `payments`
- `AuditLog`
- `Attachment` service (new `RelatedModule.CRM_COMPANY`)
- The `/masters/customers/:id` page ("Open ERP customer")

### CRM pieces reused

- `runCrmMutation`, which now also bumps `last_activity_at` for COMPANY events
- events / timeline, notes, tags, custom fields (`entityType COMPANY`)
- saved views (COMPANY validator), sources, `crm_addresses.crm_company_id`
- option values (new lists: company industry, company type)
- CrmTable / filter bar / bulk bar / column picker / record header

### CRM-specific fields (`crm_companies`)

| Group | Fields |
|---|---|
| Identity | name, legal name, display name, company type, industry |
| Contact details | website, email, phone, mobile |
| Location | city, state, postal code, country |
| Relationships and status | status, source, source lead, owner, primary contact |
| CRM data | custom fields, tags (tag table) |
| Activity and duplicates | last activity, duplicate flag and flagged ids |
| Merge and archive | merged into / at / by, archived by, updated by, version |
| Derived (search and duplicate checks) | name / legal match keys, website key, email / phone keys, search text |

### Relationships

- **ERP customer:** company → customer (0..1, unique).
- **Contacts:** company ← contacts (many). The company points to one primary contact.
- **Leads:** company ← leads (many), plus the source lead.
- **Opportunities:** company ← opportunities.
- **Other records:** addresses, notes, documents, tags and events attach to the company.
- **Merges:** company ← companies merged into it, recorded in `crm_company_merges`.

## Duplicate strategy

- **Stored match keys:** `name_match_key`, `legal_match_key`, `website_key`, `email_keys`, `phone_keys`, all indexed (GIN for the arrays). One candidate query runs per save.
- **When it runs:**
  - create (form, ERP-customer pick, lead conversion)
  - edit of any matching field
  - linking a customer
  - live as you type (`POST /companies/duplicate-check`)
- **Actions:**
  - **Warn** → 409 `CRM_POSSIBLE_DUPLICATE`, with the matches shown and **Save anyway**.
  - **Block** → 409 `CRM_DUPLICATE_RECORD` (`details.blocking`).
  - **Flag** → saved and marked "Possible duplicate". The detail page offers **Review & merge** or **Not a duplicate**, and the list can be filtered by it.
  - **Allow** → the rule is not checked.
- **What is checked:**
  - Archived companies count (they are labelled); merged companies never count.
  - A name alone never blocks by default.
- **Same ERP customer:** always blocked, independent of the rules.
- **Implicit company creation:** creating a company implicitly from a contact's ERP-customer pick never blocks on similar names; it flags them instead.

## Merge strategy

1. **Preview** (`GET /companies/merge/preview`): both companies, conflicting fields (both filled and different), custom-field conflicts, ERP conflict, whether the ERP link moves, and counts of what moves.
2. **Merge** (`POST /companies/merge`): one transaction that row-locks both companies and re-checks versions and state.
   - **Unresolved conflicts** → 400 listing them. Empty fields are filled deterministically from the other company; everything else needs an explicit choice.
   - **Moved to the survivor:**
     - contacts (contact derived fields are refreshed)
     - leads, opportunities, notes, documents (attachments re-pointed), addresses (the survivor keeps its primary), tags (de-duplicated)
     - earlier merges (chains stay resolvable)
   - **ERP safety:**
     - Two different customers → refused.
     - Only the merged company linked → the link moves to the survivor (it is cleared on the merged company first, so the unique key always holds).
     - The customer row is never written.
   - **Values not kept** are written to a note on the survivor (by name, never raw ids).
   - **The merged company** is archived with `merged_into_id`, kept read-only with a banner, and its history shows on the survivor's timeline.
   - **`crm_company_merges`** keeps the field choices, a full snapshot and the moved counts.
   - **Audit and events:** audit rows plus `company.merged`, `company.merged_into` and `company.erp_customer_linked` (fromMerge).

## Database (migration `20261004100000_crm_companies`, additive only)

- **`crm_companies`:** the new columns above, 10 indexes (2 GIN), and foreign keys to statuses, sources, source lead, primary contact and itself (merged into).
- **New tables:**
  - `crm_company_statuses` (unique `(company_id, key)`)
  - `crm_company_merges` (unique `merged_id`)
- **Other changes:**
  - `crm_settings.company_duplicate_rules` (JSONB)
  - `RelatedModule` gains `CRM_COMPANY`
- **Back-fill for existing companies:**
  - default statuses and initial status
  - match keys (SQL identical to `companyMatchKey`, verified for parity)
  - website / email / phone keys and search text
  - last activity, primary contact (earliest active contact), source lead and source (earliest converted lead)
- **ERP tables:** none are altered.

## API (`/api/v1/crm/…`, all via `crmRoute`, tenant-scoped, visibility-checked)

| Method + path | Purpose |
|---|---|
| `GET/POST companies` | List (search, filters, sort, page) / create |
| `GET companies/meta`, `companies/lookup`, `companies/customers` | Form metadata; company picker (≤200); ERP customer picker (≤50, identity fields only, 403 without customer access) |
| `POST companies/duplicate-check` | Live duplicate check |
| `POST companies/bulk` | assign / status / addTags / removeTags / archive (≤500, skipped reasons) |
| `GET companies/merge/preview`, `POST companies/merge` | Merge |
| `GET/PATCH companies/:id` | Detail / edit (strict schema, optimistic `version`) |
| `POST companies/:id/assign`, `status`, `tags`, `archive`, `restore`, `dismiss-duplicate` | Record actions |
| `POST/DELETE companies/:id/erp-customer` | Link / unlink ERP customer |
| `GET companies/:id/erp-references` | ERP documents (per-section paging, permission + branch scoped) |
| `GET/POST companies/:id/contacts`, `DELETE …/contacts/:contactId`, `PUT …/primary-contact` | Contacts (paged) |
| `GET/POST companies/:id/leads`, `DELETE …/leads/:leadId` | Leads (paged, incl. merged companies) |
| `GET companies/:id/opportunities` | Opportunities (paged; pipeline/stage null until Phase 06/07) |
| `GET/POST companies/:id/notes`, `documents`; `POST/PATCH/DELETE …/addresses` | Notes, documents, addresses |
| `DELETE documents/:attachmentId`, `GET …/download` | Shared CRM document routes (contact + company); old `contact-documents` routes kept as aliases |
| `GET/POST settings/company-statuses`, `PATCH …/:id`, `POST …/reorder`; `GET/PUT settings/company-duplicate-rules` | Settings |
| `GET events?entityType=COMPANY&entityId=…[&includeRelated=true]` | Timeline (merged companies always; contacts/leads on request, visible ones only, capped at 500 ids) |

## UI

- **CRM → Companies** (new nav entry).
- **List:**
  - Columns: company (with legal name), industry, primary contact, owner, status, source, phone, email, city, ERP customer code, open opportunities, tags, last activity, created. Choose them with the column picker.
  - Search covers name / legal / website / email / phone digits / city / customer code.
  - Filters: owner, unassigned, status, source, tag, industry, company type, city / state / country (also matches addresses), ERP linked / not linked, origin (from lead / direct), flagged duplicates, created / updated / last-activity ranges, archived.
  - Saved views, bulk actions, and row actions: View / Edit / Assign / Change status / Tags / Merge / Archive / Restore / **Open ERP customer**.
- **Form:**
  - Live duplicate panel; Save anyway / blocked.
  - On create: optional ERP customer search (already-linked customers are disabled), primary address, tags.
  - Custom fields.
  - **No automatic ERP customer creation.**
- **Detail (organisation 360):**
  - header with status / owner / primary contact / counts
  - merged banner, flagged-duplicates panel
  - company info
  - contacts (paged; add existing / new contact preselected / set primary / remove)
  - leads (paged; associate / unlink), opportunities (paged)
  - addresses, custom fields, notes
  - timeline with an "Include contacts & leads" toggle
  - ERP customer card (link / unlink / open)
  - "Quotations, orders, invoices & tickets" (ERP references plus honest "not available" lines)
  - documents, later-phase placeholders, record info
- **Merge screen:** pick / swap, mandatory conflict choices highlighted, ERP-conflict explanation (no merge button), "what happens" summary.
- **Settings:** new **Company statuses**, **Company custom fields** and **Company duplicate rules** tabs; "Contact options" becomes **Contact & company options** (industries, company types).
- **Cross-links:**
  - Lead detail and contact detail / list link to the company page.
  - "+ New contact" on a company preselects it (`/crm/contacts/new?companyId=`).

## Security

- **Tenant and visibility:** every query is tenant-scoped. `crm.view` = own + unassigned-created-by-me; `crm.view_all` = all. Records outside scope return 404, including in merge, documents, the timeline and related lists.
- **Permissions for changes:** `crm.create` (create, notes, documents) and `crm.edit` (edit, link, merge, archive, relations, bulk). Settings need `crm_settings`.
- **ERP access:** customer linking needs customer access. ERP sections need each module's view permission and follow branch access. The customer picker returns identity fields only (no balances / credit).
- **Update safety:** strict update schema (`customerId` can't be changed via edit) and optimistic locking on edits and merges.
- **Documents:** only `CRM_CONTACT` / `CRM_COMPANY` attachments are reachable through CRM routes.
- **No secrets** in the frontend or logs.

## Performance

- Indexed match keys, so the duplicate check is a single query.
- **List queries:**
  - Paged list with `count` + `findMany` in parallel.
  - Open-opportunity counts in one `groupBy` per page.
  - Tag filter resolved to ids once.
- **Detail page:**
  - Counts from three parallel indexed `count` queries.
  - Contacts / leads / opportunities / ERP sections are each separately paged endpoints (≤50 per page). No N+1 queries, no unbounded loads.
- Timeline related scope is capped at 500 ids.

## Automated verification

- **Vitest:**
  - Without a DB: 139 files; **2,261 passing**, 62 DB tests skipped (Phase 04: 2,217).
  - With `CRM_IT_DATABASE_URL`: **2,323 / 2,323 passing**; the CRM suites alone are 181.
- **New company integration suite** (14 tests, real Postgres):
  - create (defaults, keys, address, tags, audit, events)
  - search / filters / sort / paging / OWN visibility
  - duplicates: Warn / suffix / domain / Block / Flag / dismiss
  - ERP link (permission, missing, deleted, already linked, references, unlink); **customer row byte-identical after link / unlink / merge / archive**
  - contacts (move confirmation, primary, remove, paging)
  - leads and conversion → opportunities, timeline with related events
  - merge (unresolved conflicts, version conflict, everything moved, ERP link moved, note with names, snapshot, repeat refused)
  - ERP-conflict merge refused, invisible merge refused
  - archive / restore, versioning / status / owner events
  - bulk with skipped ids, saved views, documents, status settings invariants, timeline access
- **Unit tests (22):**
  - match keys and website keys, derived fields
  - duplicate evaluation (legal both ways, strictest action, ERP always Block, confirmation codes)
  - merge helpers
  - filters (round-trip, scoping, search, location, sort)
  - schemas (strict update, bulk), registry
- **Route tests (9):** permissions, 400 / 409 / 403, limits and paging caps.
- **Component tests (7):** status badge, duplicate panel warn / block, bulk status, linked customers disabled, contact move confirmation flow, ERP-conflict merge screen.
- **Updated tests:** events route (scopes), entity registry (company href), navigation.
- **Static checks:** `tsc` is clean. ESLint has 0 errors (the same 12 pre-existing warnings, none in CRM).
- **Migrations:**
  - All **156** apply to an empty Postgres DB, the seed runs, and tables / columns / enums match the schema.
  - A Phase 04 database with data upgrades in one pass (status, keys, source lead and primary contact back-filled).
  - SQL ↔ JS match-key parity was checked on edge cases (accents, "&", "The", stacked suffixes).
- **Browser test** (fresh seeded DB, headless Chromium):
  - empty list + nav
  - create linked to ERP customer "EuroTrend Fashion GmbH" with address
  - ERP card + references (quotations / tickets "not available")
  - suffix + same-domain duplicate → live warning → 409 → Save anyway
  - "+ New contact" preselects the company → set primary
  - note, status → Customer
  - timeline with related events
  - list filter "ERP linked" + search
  - merge (Name / Website / Status had to be chosen) → merged banner
  - settings tabs
  - **The ERP customer row's checksum was unchanged after the whole run.** The only console error is the expected 409.

## Manual test checklist (your machine)

```powershell
npx prisma generate
npx prisma migrate deploy        # applies 20261004100000_crm_companies
npm test
npm run dev
```

1. **CRM → Companies.** Existing companies (from conversions / contacts) are listed with a status (Customer if linked to an ERP customer, else Prospect).
2. **New company:**
   - Name, website, email, phone, industry (suggestions), city.
   - Pick an ERP customer: a customer already linked elsewhere is greyed out.
   - Address, tag. Save.
   - The detail page shows the ERP card with **Open ERP customer**, and "Quotations, orders, invoices & tickets" lists that customer's documents (quotations / tickets say the ERP has no such module).
3. **New company "<same name> Pvt Ltd"** or the same website: a live warning appears; Save shows the matches and **Save anyway** works.
4. **Settings → Company duplicate rules:**
   - Website → **Block**: retry is refused.
   - Name → **Flag**: saves with "Possible duplicate" (detail panel: Review & merge / Not a duplicate; list filter "Flagged duplicates").
   - Reset the rules.
5. **Contacts on a company:**
   - **+ New contact** (company preselected).
   - **+ Add existing** with a contact from another company: you are asked to confirm the move.
   - **Set primary**, **Remove**. The contact still exists.
6. **Leads:** **+ Associate lead**, then convert a lead into this company with an opportunity. Leads and Opportunities show it; **Unlink** works.
7. **Status / owner / tags:**
   - Change status (⋮), assign to another user, edit tags.
   - Timeline shows each change. Tick **Include contacts & leads**.
8. **ERP link:** **Unlink** then **Link customer** again. Check the customer in Masters is unchanged.
9. **List:**
   - Search by phone digits / customer code.
   - Filters (ERP linked, From lead, Location, Status, Last activity).
   - Sort, columns, **Save as view**.
   - Bulk: Assign / Change status / Tags / Archive; restore from the Archived filter.
10. **Merge:**
    - Select two → **Merge**. Conflicts must be chosen; **Swap**.
    - Confirm. The survivor has the contacts, leads, notes, documents, tags and addresses, plus a "Values not kept" note.
    - The merged one shows a banner.
    - Two companies linked to *different* ERP customers: the merge screen explains why it can't merge.
11. **Archive / restore** a company: its contacts, leads and the ERP customer are unaffected.
12. **As a rep without `crm.view_all`:** only own / created companies are visible; another rep's company URL gives 404. Without customer access, linking is not offered and the ERP sections say "no access".
13. **Settings:** Company statuses (add, rename, colour, default, deactivate, reorder); Company custom fields; Contact & company options.
14. **Regression:** Leads (create / convert to new / existing company), Contacts (create with ERP customer, documents, merge), Customers master, Sales Orders.

## Known limitations / deferred

- **One company per contact.** Multi-company relationships with per-company roles are a future extension (a link table).
- **Merge is pairwise** with no unmerge screen. The snapshot in `crm_company_merges` holds what an unmerge would need.
- **No quotation or ticket modules in the ERP.** Those sections are explicit placeholders.
- **Activities / appointments / conversations** arrive in Phases 09–11. **Pipelines / stages** arrive in Phases 06–07; opportunities are read-only lists here.
- **No company import** yet. The lead-import pipeline can be reused.
- **Bulk is synchronous** (≤500); the async engine is Phase 14.
- **The merge-screen company picker** loads up to 200 companies (as for contacts). The customer and contact / lead pickers are server-side search.
- **The SQL back-fill's `search_text`** is a close approximation of the JS one; a company's text is rebuilt exactly on its next edit.
- **Status isn't synced from ERP activity** (e.g. Customer → Former customer). That would be a workflow (Phase 18) on ERP events.

## Extension points

- **Statuses / option lists:** configurable in Settings, defaults in `company-registry.ts`.
- **Duplicate rules:** add a rule key + match key in `company-keys.ts` / `company-duplicates.ts`.
- **Related sections:** replace a `COMPANY_FUTURE_SECTIONS` entry with a real provider (Phases 09–11, tickets). Add quotation / ticket sections to `crm-erp-references.service.ts` once those ERP modules exist.
- **Opportunities (Phase 06/07):** `listCompanyOpportunities` already returns `pipeline` / `stage` slots.
- **Workflows (Phase 18):** consume the `company.*` events (created, updated, owner_changed, status_changed, tag_*, contact_added / removed, primary_contact_changed, lead_linked / unlinked, opportunity_linked, document_*, erp_customer_linked / unlinked, duplicate_flagged / dismissed, merged / merged_into, archived / restored).
- **Smart Lists (Phase 13):** `companyFilterSchema` is stored unchanged by saved views.

## Assumptions

- `Customer` is the organisation master. `Buyer` (brand under a customer) remains ERP-only and is not mirrored.
- "Open ERP customer" uses the existing `/masters/customers/:id` page and needs `masters_core.view` to open.
- Customer access for linking = `masters_core.view` **or** `sales_orders.view` (same rule as the Phase 04 contact form).
- Merge requires `crm.edit` (not `crm.delete`), as for contacts.

## CLAUDE.md entry (appended on your machine)

```markdown
## CRM rebuild — Phase 05 Companies (2026-10-03)
- `crm_companies` is the CRM account (prospects + customers). The ERP `Customer` stays the only customer master: link via unique `customer_id` only (`linkErpCustomer` validates exists/not deleted/permission/not linked elsewhere). Never write customer rows from CRM code; never copy balances/invoices.
- All company writes go through `src/modules/crm/companies/crm-companies.service.ts` (relations: `company-relations.service.ts`, merge: `company-merge.service.ts`). Derived keys come from `company-keys.ts` — keep `companyMatchKey` identical to the SQL in migration 20261004100000.
- Company duplicate rules (NAME/LEGAL_NAME/WEBSITE/EMAIL/PHONE × WARN/BLOCK/FLAG/OFF) in `crm_settings.company_duplicate_rules`; same ERP customer is always BLOCK. Never auto-merge.
- Merge never deletes and refuses different ERP customers; only one ERP link survives. Every company query must exclude `merged_into_id IS NOT NULL` (buildCompanyWhere does).
- Statuses: `crm_company_statuses` (lazy defaults via ensureCompanyStatusDefaults). ERP references (contacts + companies) live in `src/modules/crm/erp/`; documents for both in `src/modules/crm/documents/`.
- Report: `docs/crm/PHASE_05_COMPANIES.md`.
```
