# CRM Phase 04 — Contacts: Report & Test Checklist

Branch on your machine: `crm-build-v2` (Phase 03 committed as `7dfb864`). Phase 04 files are written to the repo, **not committed**.

## Decisions applied (recommended options; change any of them after testing)

| Topic | Decision |
|---|---|
| Person master | The ERP has **no person/contact master** (`Customer` = organisation, `Buyer` = brand under a customer, `contactPerson` is free text). `crm_contacts` is the CRM's person record. It reaches the ERP Customer **only through its CRM company** (`crm_companies.customer_id`). No customer data is copied. |
| Company relationship | One primary company per contact (`crm_company_id`) plus a free-text **relationship role** (decision maker, influencer…). The contact form can pick an **ERP customer** directly: the CRM company that references it is reused or created (name + city/country only). Multi-company links with roles are a Phase 05 extension. |
| Addresses | The ERP has only free-text addresses, so there is a new `crm_addresses` table. It has typed FKs (`contact_id` now, `crm_company_id` for Phase 05), a CHECK that exactly one is set, multiple addresses per record, a type, and one primary. |
| Channels | The core columns (email, alternate email, phone, mobile, WhatsApp) stay. Extra values go into `crm_contact_channels`, whose type is validated in code so new channels need no migration. Extra emails and phones feed search and duplicate keys. |
| Designation / department / role | Free text with **suggestions** managed in CRM Settings → Contact options (`crm_option_values`). Free text keeps imports and integrations simple. |
| Source | Reuses the CRM source list (`crm_lead_sources`), defaulting to Manual. Conversion copies the lead's source and keeps `source_lead_id`. |
| Duplicate rules | Separate contact rules in CRM Settings: email, phone, mobile, WhatsApp, name + company, name + email. Each can be set to **Warn / Block / Flag / Allow**. Defaults: email, mobile, WhatsApp and name + company **Warn**; phone (shared office landlines) and name + email **Allow**. |
| Merge | Survivor ← merged, with a per-field choice. Nothing is lost or deleted (details below). Requires `crm.edit` and visibility of both contacts. |
| DND / contactability | One current row per contact + channel (`ALL`, `EMAIL`, `PHONE`, `SMS`, `WHATSAPP`) with status, reason (required unless Allowed), source, time and user. History is kept in the timeline and AuditLog. `ALL` overrides every channel. |
| Visibility | Same rule as leads: `crm.view` = own + unassigned-created-by-me; `crm.view_all` = everyone. ERP sections additionally need that ERP module's `view` permission and follow branch access. |

## Architecture

```
src/modules/crm/contacts/
  contact-registry.ts         client-safe vocab: channel types, contactability channels/statuses/sources,
                              address types, option lists, duplicate rule labels + defaults, later-phase sections
  contact.schema.ts           zod (client-safe): create/update, sub-records, filter (+ parse/toParams), sort, bulk, merge
  contact-keys.ts             pure: full name, name key, email/phone match keys (core + channels), search text
  contact-duplicates.ts       rule evaluation (pure) + indexed candidate query + enforcement (BLOCK/WARN/FLAG)
  contactability.ts           pure canContact(), per-channel summary, stricter-wins merge rule
  contact-filters.ts          the one ContactFilter → Prisma where/orderBy translation (company + visibility + not merged)
  crm-contact.repository.ts   all contact data access (list/detail/raw/versioned update/locks/sub-records/related)
  crm-contacts.service.ts     create/update/assign/tags/archive/restore/duplicates/channels/addresses/contactability/bulk,
                              plus the Phase 02 surface used by lead conversion (createCrmContactInMutation…)
  contact-merge.{repository,service}.ts   merge preview + transactional merge
  contact-related.{repository,service}.ts linked leads/opportunities, ERP references, documents
```

**Reused (nothing duplicated):**

- ERP users (owners)
- ERP RBAC (`crm`, `crm_settings`, plus `masters_core` / `sales_orders` / `buyer_enquiries` / `invoices` / `payments` view for ERP sections) and branch access (`branchScopeWhere`)
- ERP AuditLog
- ERP attachment service (new `RelatedModule.CRM_CONTACT`)
- `runCrmMutation` (one transaction for record + audit + events)
- CRM events/timeline
- tags, notes, custom-field engine (`entityType CONTACT`), saved views (CONTACT validator), CRM sources, CrmTable / filter bar / bulk bar / column picker / record header / notes / timeline components

**Timeline:**

- A contact's timeline is its `crm_events` **plus the events of every contact merged into it** (recursive over `crm_contact_merges`).
- `runCrmMutation` now bumps `crm_contacts.last_activity_at` for every CONTACT event in the same transaction, whichever service emitted it (notes, tags, merge…).
- New event types: `contact.owner_changed`, `tag_added`/`tag_removed`, `note_*`, `address_*`, `channel_*`, `contactability_changed`, `document_added`/`document_removed`, `lead_linked`, `duplicate_flagged`/`duplicate_dismissed`, `merged`, `merged_into`, `archived`, `restored`.

**Interfaces for later phases (no fake data):**

- `CONTACT_FUTURE_SECTIONS` drives honest placeholders for:
  - Activities and Tasks (Phase 09)
  - Appointments (Phase 10)
  - Conversations (Phase 11)
  - Sequences (Phase 17)
- `canContactContact(actor, id, channel)` and `GET /contacts/:id/can-contact?channel=` is the check campaigns, sequences, the inbox and telephony must call. It follows merges.

## Duplicate strategy

- Keys are stored on every contact:
  - `name_key`
  - `email_keys`: email, alternate email and extra email channels
  - `phone_keys`: last 10 digits of phone, mobile, WhatsApp and extra phone channels
- A check is one indexed query (GIN on keys; `(company_id, name_key)` for name + company). Rules are then evaluated per candidate.
- **Phone, mobile and WhatsApp are per-field rules:** "this field's number is already on another contact". A shared landline can be allowed while the same mobile warns.
- Merged contacts never count. Archived contacts do count, and are labelled as archived.
- **Block** always refuses (`409 CRM_DUPLICATE_RECORD`, `details.blocking = true`).
- **Warn** refuses until the user confirms (`409 CRM_POSSIBLE_DUPLICATE`; resend with `confirmDuplicate: true`).
- **Flag** saves and sets `duplicate_flagged_at` + `flagged_duplicate_ids`. The contact shows a "Review & merge / Not a duplicate" panel and appears under the "Flagged as possible duplicate" filter.
- Lead conversion uses the same rules:
  - A Warn shows the existing contact with "Link this instead / Create a new one anyway".
  - A Block hides "create anyway".

## Merge strategy

Runs in one transaction. Both rows are locked (`SELECT … FOR UPDATE`, in id order), versions are re-checked under the lock, and `crm_contact_merges.merged_id` is unique.

1. **Fields:** the user picks per field. The default is the survivor's value, or the merged one's when the survivor's is empty. Custom fields follow the same rule (per key).
2. **Nothing lost:** emails and numbers that don't win a core field become extra channels on the survivor. The merged contact's channels are copied over.
3. **Moved to the survivor:**
   - leads (`crm_contact_id`)
   - opportunities
   - notes
   - tags (union)
   - addresses (survivor keeps its primary)
   - documents (attachments)
   - contacts previously merged into the merged one
4. **Contactability:** per channel the stricter status wins. Rows are marked source MERGE, with the reason "from merged contact X".
5. **Merged contact:** gets `merged_into_id`, `merged_at` and `merged_by`, and is archived. It is **never deleted**, never listed, read-only, and its page shows a banner linking to the survivor.
6. **Merge record:** a `crm_contact_merges` row stores the field choices, a full snapshot of the merged contact (core, channels, addresses, consents, tags) and the moved counts.
7. **Audit and timeline:** AuditLog rows for both contacts and the merge; events `contact.merged` (survivor) and `contact.merged_into` (merged).

**Refused cases:** a self merge; merging an already-merged contact or into one; an archived survivor; a stale version; a contact outside the user's visibility (`NOT_FOUND`). Of two concurrent merges of the same contact, exactly one wins (tested).

## Database (migration `20261003100000_crm_contacts`, additive only)

- **`RelatedModule`:** adds `CRM_CONTACT`.
- **New enums:** `CrmAddressType`, `CrmContactabilityStatus`.
- **`crm_contacts` new columns:**
  - `middle_name`, `name_key`, `department`, `relationship_role`, `alternate_email`, `search_text`
  - `source_id` → crm_lead_sources; `source_lead_id` → crm_leads
  - `last_activity_at`, `duplicate_flagged_at`, `flagged_duplicate_ids`
  - `merged_into_id` → self, `merged_at`, `merged_by_user_id`
  - `archived_by_user_id`, `updated_by_user_id`, `version`
  - Indexes: archived/created, owner, name key, last activity, merged_into.
- **New tables:** `crm_addresses`, `crm_contact_channels`, `crm_contact_consents`, `crm_contact_merges`, `crm_option_values`.
- **`crm_settings`:** adds `contact_duplicate_rules` (null = defaults).
- **Back-fill of existing Phase 02 contacts:**
  - `name_key`, `search_text`
  - `last_activity_at` (latest event, else `updated_at`)
  - `source_lead_id` + `source_id` from the earliest converted lead

## API (`/api/v1/crm/…`, all via `crmRoute`)

| Method & path | Permission | Purpose |
|---|---|---|
| GET `contacts` | crm.view | list: search, filters, sort, paging (filter params as in `parseContactFilterParams`) |
| POST `contacts` | crm.create | create (409 warn / block) |
| GET `contacts/meta` · POST `contacts/duplicate-check` · GET `contacts/company-options` · GET `contacts/lookup?limit=` | crm.view | form data, live duplicate check, CRM companies + ERP customers, picker |
| GET / PATCH `contacts/:id` | view / edit | detail · versioned update |
| POST `contacts/:id/assign` · `archive` · `restore` · `tags` · `dismiss-duplicate` | crm.edit | focused actions |
| POST `contacts/:id/channels` · DELETE `…/channels/:channelId` | crm.edit | extra contact details |
| POST `contacts/:id/addresses` · PATCH / DELETE `…/addresses/:addressId` | crm.edit | addresses |
| PUT `contacts/:id/contactability` · GET `contacts/:id/can-contact?channel=` | edit / view | DND |
| GET / POST `contacts/:id/notes` | view / create | notes |
| GET `contacts/:id/related` · GET `contacts/:id/erp-references` | crm.view | leads + opportunities · ERP documents (per-module permission) |
| GET / POST `contacts/:id/documents` · GET `contact-documents/:attachmentId/download` · DELETE `contact-documents/:attachmentId` | view / create / view / edit | documents (delete: uploader or view_all) |
| POST `contacts/bulk` | crm.edit | assign / addTags / removeTags / archive (≤500, skipped reasons) |
| GET `contacts/merge/preview` · POST `contacts/merge` | crm.edit | merge |
| GET / PUT `settings/contact-duplicate-rules` · GET / POST `settings/option-values` · PATCH `settings/option-values/:id` | crm_settings | settings |
| GET `events?entityType=CONTACT&entityId=` | crm.view | timeline (includes merged contacts) |

## UI

**List** (`/crm/contacts`, nav: CRM → Contacts):

- Columns (column picker): name + designation, company, email, phone, department, owner, source, tags, contactability, last activity, updated, created.
- Server-side search: name, email(s), phones (digit match), company, designation, department, extra channels.
- Filters:
  - owner, unassigned, source, tag
  - company, designation, department, location (address)
  - do-not-contact per channel, has email / phone
  - ERP customer linked, origin (from lead)
  - flagged duplicates
  - last activity / created / updated ranges
  - archived
- Sort, pagination, saved views (private / shared), bulk assign / tags / archive / merge (2 selected).
- Row actions: View / Edit / Assign / Edit tags / Add note / Merge with… / Archive / Restore.

**New / Edit:**

- person, company & role (CRM company or ERP customer; datalist suggestions), contact details, owner, source
- primary address and tags (on create), custom fields
- live duplicate check; Warn → "Save anyway"; Block shown in red

**Detail:**

- header (badges: Archived / Merged / DND / Possible duplicate)
- flagged-duplicate review panel
- contact information + extra details
- company (with ERP customer)
- addresses, custom fields, notes, timeline (incl. merged)
- contactability per channel
- related leads / opportunities, documents, ERP references
- "Coming in later phases" placeholders
- record (origin lead, created, updated, merged-in)

**Merge** (`/crm/contacts/merge?ids=a,b`): pick or swap which contact to keep, per-field radio choice incl. custom fields, a "What happens" summary with counts, then confirm.

**Settings:** new tabs Contact custom fields, Contact duplicate rules, Contact options. "Lead sources" is renamed "Sources" because contacts use it too.

**Leads:** the converted contact links to its page; conversion respects contact Block rules.

## Security

- **Scoping:** every query is company-scoped. Sub-record lookups (address, channel) include `company_id` (the company-scoping contract test covers it). Visibility is applied in one place (`buildContactWhere` / `loadContactForActor`).
- **Documents:** only `CRM_CONTACT` attachments are reachable through the CRM document routes, after a visibility check on the owning contact. Others' files get `NOT_FOUND`.
- **ERP references:** read-only, each section gated by its own ERP permission and branch access. The CRM never writes ERP tables.
- **Concurrency:** merge locks rows, and versioned updates prevent lost edits.
- **Input:** all inputs are zod-validated; channel values are normalised; URLs are http(s) only. No secrets are involved.

## Automated verification (sandbox copy, identical to your repo before this phase)

- **Vitest:** 135 files; **2,217 passing**, 0 failing. 48 DB tests skip without a test DB; before Phase 04 it was 2,185 / 34.
- **Real Postgres** (`CRM_IT_DATABASE_URL`): all CRM suites **163 passing**, including the new 14-test contact integration suite:
  - create (keys, address, channel, tags, audit, events)
  - duplicate Warn / extra-channel / Block / Flag / dismiss, shared landline allowed
  - ERP customer link reuse + ERP references + name + company rule
  - version conflict, owner history, visibility
  - DND per channel / ALL + filter + archived
  - archive / restore
  - addresses primary + channels refresh keys
  - lead conversion (source + `source_lead_id`, warn, link → `lead_linked`, related leads)
  - full merge (fields, leftover channels, addresses, stricter DND, leads / notes / tags moved, snapshot, timeline incl. merged, read-only merged, repeat / reverse merge refused, can-contact follows merge)
  - concurrent merges (one wins), invisible-contact merge refused
  - documents through the attachment service moved on merge + access guard
  - bulk with skipped reasons, last activity bump
  - saved views
- **Unit tests:** keys, duplicate rules, contactability, filters (round-trip, scoping, DND, phone search, sort), schemas, merge rules. Plus route permission tests, nav and component tests.
- **Static checks:** `tsc` is clean; ESLint has 0 errors (the same 12 pre-existing warnings).
- **Migrations:** all 155 apply to an empty Postgres 16 DB, the seed runs, and tables / columns / enums match the schema. A Phase 03 database with data upgrades in one pass (existing contact back-filled with name key, search text, source lead).
- **Browser test** (headless Chromium):
  - empty list
  - create with ERP customer "EuroTrend Fashion GmbH" + address
  - ERP references loaded
  - second contact with the same mobile → live warning → 409 → "Save anyway"
  - WhatsApp unsubscribe with reason, note
  - list search
  - merge page (field choices, summary) → merged → survivor shows "DND: WhatsApp (from merged contact)", timeline includes the merged contact's events
  - merged record shows its banner
  - settings tabs
  - No page errors (the only console line is the expected 409 duplicate warning).

## Manual test checklist (your machine)

```powershell
npx prisma generate
npx prisma migrate deploy        # applies 20261003100000_crm_contacts
npm test
npm run dev
```

1. **CRM → Contacts.** The list loads; existing contacts from earlier lead conversions are there, and their Record section says "Converted from lead …".
2. **New contact:**
   - First / last name, email, mobile.
   - Company: type a customer name and pick the "ERP customer" entry.
   - Designation from the suggestions; an address; a tag.
   - Save. On the detail page check:
     - Company shows the ERP customer (code).
     - **ERP references** lists that customer's enquiries / orders / invoices / receipts (if any exist) with working links.
3. Create another contact with the **same mobile:** a live warning appears. Save shows the matches and **Save anyway** works.
4. **CRM Settings → Contact duplicate rules:**
   - Set Mobile to **Block**, retry: saving is refused.
   - Set it to **Flag**: the contact saves with "Possible duplicate"; the panel offers **Review & merge** / **Not a duplicate**.
   - Put the rules back.
5. On a contact:
   - **+ Add detail** (second mobile, LinkedIn).
   - **+ Add address** (make it primary), edit and remove one.
   - **Contactability → Change** on WhatsApp → Unsubscribed with a reason. The header shows "DND: WhatsApp".
   - Set **All channels** → Do not contact. The header shows "Do not contact"; the list filter **Do not contact → Contact-wide DND** finds it.
6. Add a note, upload a PDF under **Documents** (preview / download), and check the **Timeline**.
7. **List:**
   - Search by part of a phone number and by company.
   - Filters: Owner, Tag, Location, Last activity.
   - Sort by Last activity / Company; change columns.
   - **Save as view** (shared), reload, apply it.
8. **Bulk:** select contacts → Assign / Add tags / Remove tags / Archive. Skipped reasons are shown. Restore from the Archived filter.
9. **Merge:**
   - Select two duplicates → **Merge** (or ⋮ → Merge with…).
   - Pick values, use **Swap** if needed, then confirm.
   - The kept contact has the notes, tags, documents, addresses and linked leads, plus the other email / number as extra details; the stricter DND is kept.
   - Open the merged one: banner + read-only.
   - Its history shows on the kept contact's timeline.
10. **Lead conversion:** convert a lead with **Create contact**. The contact gets the lead's source and "Converted from lead …". Convert another lead with the same email: the existing contact is offered ("Link this instead"). Linking adds "Lead linked" to the contact timeline.
11. **As a rep without `crm.view_all`:** only own / created contacts are visible; another rep's contact URL gives 404; merge with it is refused. Without Sales Orders / Invoices permissions the ERP sections say "You don't have access".
12. **Regression:** Leads list / create / convert, Import Leads, CRM settings (lead statuses, sources, custom fields), Customers master, Sales Orders.

## Known limitations / deferred

- **Merge is pairwise** (one into one). Merge three by repeating. There is no unmerge screen; the snapshot in `crm_contact_merges` holds what an unmerge would need.
- **One primary company per contact.** Multiple companies with roles per company are a Phase 05 (Companies) extension of `crm_contact_company` links. The CRM company record for an ERP customer is created with name and location only; company pages and customer linking from the company side come in Phase 05.
- **Opportunities** are listed read-only (no pages until Phase 06).
- **Pickers load a list once:** the company / customer and merge pickers load up to 200 entries and filter in the browser. A server-side type-ahead picker is a later UI improvement.
- **Bulk actions are synchronous** (≤500); the async Bulk Action Engine is Phase 14. There is no contact import yet (lead import exists; contact import can reuse the ingestion pipeline later).
- **Timeline scope:** it includes merged contacts but not the linked leads' own events (open the lead for those).
- **`last_activity_at` reflects CRM events on the contact.** Calls, emails and meetings join it when Phases 09–11 emit their events.

## Extension points

- **New channel type or option list:** add an entry to `contact-registry.ts` (no migration).
- **Related sections:** replace an entry of `CONTACT_FUTURE_SECTIONS` with a real provider in `contact-related.service.ts` (Phase 09/10/11/17).
- **Sending features:** call `canContactContact()`, or `canContact()` on loaded consents, before any outbound message, and record unsubscribes / bounces via `setContactability` with source `UNSUBSCRIBE_LINK` / `PROVIDER_BOUNCE` (sources are free text).
- **Workflows (Phase 18):** consume the `contact.*` events listed above.
- **Phase 05:** reuse `crm_addresses.crm_company_id`, `findOrCreateCrmCompanyForCustomer`, and the duplicate / merge patterns for companies.
- **Smart Lists (Phase 13):** `contactFilterSchema` is stored by saved views unchanged.

## CLAUDE.md entry (appended on your machine)

```markdown
## CRM rebuild — Phase 04 Contacts (2026-10-03)
- `crm_contacts` is the CRM person record (ERP has no person master). It reaches the ERP Customer only via `crm_companies.customer_id`; picking a customer uses `findOrCreateCrmCompanyForCustomer` — never copy customer data.
- All contact writes go through `src/modules/crm/contacts/crm-contacts.service.ts` (lead conversion uses `createCrmContactInMutation`). Derived columns (`name_key`, `email_keys`, `phone_keys`, `search_text`) come from `contact-keys.ts`; call `refreshContactDerived` after channel/company changes.
- Contact duplicate rules (WARN/BLOCK/FLAG/OFF, per field) live in `crm_settings.contact_duplicate_rules`; BLOCK → `CRM_DUPLICATE_RECORD` with `details.blocking`.
- Merge (`contact-merge.service.ts`) never deletes: merged contact gets `merged_into_id` + archived, everything moves to the survivor, `crm_contact_merges` keeps a snapshot. Every contact query must exclude `merged_into_id IS NOT NULL` (buildContactWhere does).
- Contactability: `crm_contact_consents` per channel (`ALL` overrides). Anything that sends messages must check `canContactContact` / `canContact` first.
- `runCrmMutation` bumps `crm_contacts.last_activity_at` for CONTACT events; contact timelines include merged contacts (`mergedContactIds`).
- Documents: ERP AttachmentService with `RelatedModule.CRM_CONTACT`; only via the CRM document routes (visibility-checked).
- Report: `docs/crm/PHASE_04_CONTACTS.md`.
```
