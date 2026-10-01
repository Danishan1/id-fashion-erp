# CRM Phase 02 — Leads: Report & Test Checklist

_Date: 2026-10-01 · Branch: `crm-marketing-rebuild-v1` · Not committed yet._

## Decisions applied

| Decision | Applied as |
|---|---|
| D5 Visibility | Users see leads they **own**, or created and that are unassigned. The new right `crm.view_all` shows every lead. SUPER_ADMIN and MANAGEMENT get it; MERCHANDISER does not. |
| Conversion targets | Minimal core `crm_companies`, `crm_contacts` and `crm_opportunities` tables. Their full pages come in later phases. |
| Duplicates | Configurable per rule (WARN / BLOCK / OFF). Default is EMAIL + PHONE = **warn, allow with confirmation**. |
| D1 Company ↔ Customer | `crm_companies.customer_id` is an optional unique link to an ERP Customer. Customer data is never copied. |

## What was built

| Area | Delivered |
|---|---|
| Lead entity | `crm_leads`: number `LEAD-YYYY-#####` (ERP numbering); person, contact and company fields; status; source; owner (ERP user); score 0–100; temperature; location; requirement; estimated value + currency; UTM, campaign and referral attribution; custom fields (JSON); last contacted / next follow-up; converted*, archived*, created/updated by; `version` (optimistic locking). Normalised `email_keys`, `phone_keys` (last 10 digits) and `search_text` are indexed for duplicates and search. |
| Statuses & sources | Per company, created lazily on first use: 7 statuses (New, Contacted, Qualified, Nurture, Unqualified, Converted, Lost) and 11 sources (manual, import, api, website, indiamart, facebook…). Statuses have a kind (Open / Converted / Lost), colour, default, order and active flag. System sources can be renamed but not deactivated. |
| Custom fields engine | `crm_custom_field_definitions`: metadata-driven, with an `entityType` column so contacts and companies can reuse it later. 13 types (text, long text, number, decimal, currency, date, date-time, yes/no, dropdown, multi-select, phone, email, URL). Server-side validation and coercion; key and type are immutable once created; archived fields keep their stored values. |
| Tags | `crm_tags` + polymorphic `crm_entity_tags`. Names are case-insensitive unique; tags are created inline from the lead form or Edit tags. |
| Notes | `crm_notes` (polymorphic, soft delete). Authors edit their own notes; authors or `view_all` users delete. Every change goes on the timeline. |
| Timeline | All lead changes write `crm_events` + AuditLog in one transaction: created, updated (field diff), status/owner changed, tag added/removed, note added/updated/deleted, opportunity created, converted, archived, restored. |
| List page `/crm/leads` | Server-side search (name, email, phone, company, lead #), filters (status, kind, source, owner/unassigned, temperature, tags, company, location, score and value ranges, four date ranges in IST, archived exclude/only/include), sorting with empty values last, and pagination. Column picker, saved views (private/shared, owner-only edit), row actions, multi-select with bulk Assign / Change status / Add tags / Remove tags / Archive (≤500, skipped rows reported with a reason). Filters live in the URL, so links can be shared. |
| Create / edit | Validated form with a live duplicate check while typing. On save, a WARN match shows the matches and "Save anyway"; a BLOCK match stops the save. Custom fields, tags on create, attribution section. A version conflict offers "Reload latest version". |
| Detail page | Header (status, owner, score, temperature, source, value, follow-up dates, tags) with actions Edit, Convert, Assign, Change status, Edit tags, Create opportunity, Add note, Archive/Restore. Sections: contact, company & requirement, custom fields, attribution, notes, timeline, related records (contact, company, opportunities), record info. |
| Conversion | A drawer suggests matching companies and contacts first. Company: link / create / none; contact: create / link / none (at least one); optional opportunity — all in one transaction. Creating a company or contact that matches an existing one is refused (`CRM_DUPLICATE_RECORD`) unless the user explicitly picks "Create a new one anyway". The lead stays, is marked Converted and is locked from status changes. |
| Opportunity from lead | Without converting: `OPP-YYYY-#####` linked to the lead and its contact/company. Pipelines and stages come later. |
| CRM Settings `/crm/settings` | Tabs: Lead statuses (add, edit, colour, meaning, default, active, reorder), Lead sources, Tags (rename/delete with usage count), Lead custom fields (add, edit, options, required, active, reorder), Duplicate rules. View needs `crm_settings.view`; changes need `crm_settings.edit`. |
| Navigation | CRM → Dashboard, **Leads**, Activity Log, **Settings** (Settings only with `crm_settings`). The dashboard's pipeline card now links to Leads. |
| Integration readiness | Every lead (UI, future import, API, connectors) goes through `createLead(actor, input, { sourceKey })`. Source keys are stable, so IndiaMART, Meta and similar adapters can be added later without changing the lead logic. No integration was built — none is needed in Phase 02. |

### Permissions

| New item | Meaning |
|---|---|
| Module `crm_settings` | CRM configuration screens and APIs. |
| Action `view_all` | Added to the action catalog for every module, but used only by CRM so far. |

Grants added by the migration:

- **SUPER_ADMIN:** everything.
- **MANAGEMENT:** `crm.view_all`, `crm_settings.view`, `crm_settings.edit`.

Existing roles keep their `crm.*` rights. The seed gives VIEWER `crm_settings.view`, which is read-only.

### Lead API (`/api/v1/crm`)

All under `leads`:

- `GET`/`POST /leads` — list with filters/sort/pages; create.
- `GET`/`PATCH /leads/:id` — read; update (needs `version`).
- `POST /leads/:id/` + `status`, `assign`, `tags`, `archive`, `restore`, `opportunities`.
- `GET`/`POST /leads/:id/notes` — list; add.
- `GET`/`POST /leads/:id/convert` — suggestions; convert.
- `POST /leads/duplicate-check`, `POST /leads/bulk`, `GET /leads/meta`.

### Other CRM API

- `PATCH`/`DELETE /notes/:id`
- `GET`/`POST /tags`, `PATCH`/`DELETE /tags/:id`
- `/saved-views` and `/saved-views/:id`
- `GET /companies/lookup`, `GET /contacts/lookup`
- Settings:
  - `/settings/lead-statuses` (+ `/:id`, `/reorder`)
  - `/settings/lead-sources` (+ `/:id`)
  - `/settings/custom-fields` (+ `/:id`)
  - `/settings/duplicate-rules`

### Events API changes

`/events` and `/events/:id` now respect visibility:

- A record timeline requires access to that record.
- Without `view_all`, the company-wide feed shows only your own actions.

## Database

Migration `20261001150000_crm_leads` is additive only:

- **New enums:** CrmLeadStatusKind, CrmLeadTemperature, CrmCustomFieldType, CrmOpportunityStatus, CrmSavedViewVisibility.
- **New `DocumentType` values:** CRM_LEAD, CRM_OPPORTUNITY.
- **New tables (12):** `crm_lead_statuses`, `crm_lead_sources`, `crm_leads`, `crm_companies`, `crm_contacts`, `crm_opportunities`, `crm_tags`, `crm_entity_tags`, `crm_notes`, `crm_custom_field_definitions`, `crm_settings`, `crm_saved_views`.
- **Indexes:** GIN on the email/phone key arrays.
- **Permissions:** the new permission rows and the grants above.

## Automated verification (sandbox copy)

- **Vitest:** 127 files; **2,155 passing**, 0 failing.
  - New Phase 02 tests:
    - Schema, filter and sort builder.
    - Custom-field validation.
    - Events-route visibility.
    - Navigation.
    - DataTable selection, bulk bar, column picker, number-range filter and notes panel.
    - LeadForm duplicate warn/block flow.
- **DB integration suite** (`src/modules/crm/leads/lead.integration.test.ts`, 16 tests against real Postgres):
  - Create (number, defaults, audit, event).
  - Duplicate warn / confirm / block / off.
  - Version conflict.
  - Status and owner events.
  - Own-vs-all visibility.
  - Search, filters and sort.
  - Archive and restore.
  - Bulk with skipped reasons.
  - Conversion A/B/C with no duplicate company or contact.
  - Opportunity from lead.
  - Custom fields.
  - Note permissions.
  - Settings guards.
  - Saved-view privacy.

  All pass, repeatedly. It is skipped by default; to run it against a **throwaway** database:

  ```bash
  CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/leads/lead.integration.test.ts
  ```

- **Static checks:** `next typegen` + `tsc --noEmit` are clean. ESLint has 0 errors; the 12 warnings are pre-existing and none are in new code.
- **Fresh database:** all 153 migrations applied to an empty Postgres 16 DB and the seed runs. Tables and enums match `schema.prisma` exactly.
- **Browser smoke test** (headless Chromium):
  - **Admin:**
    1. Settings: add a dropdown custom field.
    2. Create a lead.
    3. Live duplicate warning on a second lead with the same phone → Save anyway.
    4. Add a note, change status, edit tags.
    5. Convert: company, contact and opportunity are all linked.
    6. List shows 2 rows; bulk bar works.
  - **Merchandiser** (no `view_all`): sees only their own lead. The admin's lead returns 404 (page and API). Settings returns 404 (page) and 403 (API). No Settings link in the menu.
  - **Regression:** Dashboard, Customers and New Sales Order still load. No page errors.

## Manual test checklist (your machine)

```powershell
npx prisma generate
npx prisma migrate deploy        # applies 20261001150000_crm_leads
npm run dev
```

1. Log in as admin. **CRM** shows Dashboard, Leads, Activity Log, Settings.
2. **Settings → Lead statuses:** 7 statuses, New is the default. Try deactivating New → it is refused. Reorder with ↑ / ↓.
3. **Settings → Lead custom fields → Add field:** "Fabric preference", Dropdown, options Cotton and Linen.
4. **Leads → New lead:** Asha Rao, Rao Exports, asha@raoexports.test, +91 98765 43210, value 250000, Fabric = Linen, tag `export-buyer` → **Create lead**. The detail page opens with `LEAD-2026-00001` and you as the owner.
5. **New lead** again with mobile `98765-43210`. A yellow "Possible duplicate" box appears while typing. **Create lead** → **Save anyway** works.
6. Settings → Duplicate rules → Phone = **Block** → Save. Step 5 is now refused with no override. Set it back to Warn.
7. On Asha's page:
   - Add a note, then edit and delete it.
   - ⋮ → Change status → Contacted.
   - ⋮ → Assign another user.
   - Check that each step appears in the **Timeline**.
8. **Convert** → keep "Create a new company" and "Create contact", tick the opportunity → **Convert lead**. The page shows *Converted*, and Related records lists the contact, company and opportunity.
9. Convert the second lead and choose "Create a new company" named `rao exports` → it is refused as a duplicate. "Link this instead" works.
10. **Leads list:**
    - Search `9876543210`.
    - Filters → Temperature / Score range / Created "Today" → Apply. Check that the URL updates.
    - Sort by Created.
    - Columns → show Score.
    - **Save as view** "My hot leads"; switch between views.
11. Tick both rows → bulk bar → Add tags `fair-2026`; then Archive → the rows vanish. Filters → Archived = Only → **Restore** one.
12. Log in as a merchandiser-type user (without `crm.view_all`): only their own leads, no Settings link, and an admin lead URL shows Not Found.
13. **Regression:** Dashboard, Masters → Customers, Sales Orders → New, CRM Activity Log.

## Known limitations / deferred (by design)

- **Visibility leaks:** conversion suggestions and duplicate warnings can show matching records outside the user's own scope (name and number only) so duplicates aren't missed. Opening them still returns 404.
- **Bulk actions** are synchronous, with a 500-row limit. The async Bulk Action Engine is Phase 14.
- **Search** uses an indexed lower-case `search_text` contains match plus phone keys. Trigram indexing is deferred to the performance phase.
- **Contact, Company and Opportunity pages** and pipelines/stages arrive in Phases 03–05. Their tables exist now only as minimal conversion targets.
- **No external lead sources** are connected yet. Their source keys exist and `createLead` is the single entry point.

## CLAUDE.md entry (append under the CRM section)

```markdown
- **CRM Phase 02 — Leads (2026-10-01).** Lead entity + statuses/sources (lazy per-company defaults), custom fields engine (`src/modules/crm/custom-fields`, entityType-ready), tags, notes, saved views, duplicate rules (WARN/BLOCK/OFF, default warn), conversion to minimal `crm_companies`/`crm_contacts`/`crm_opportunities`, bulk (sync ≤500). Visibility: own (owner, or creator when unassigned) unless `crm.view_all`. New RBAC module `crm_settings`, action `view_all`. All lead writes go through `lead.service.ts` → `runCrmMutation` (audit + crm_events in one tx); integrations must call `createLead(actor, input, { sourceKey })`. Server pages use `getCrmPageContext()` (`src/modules/crm/core/crm-page.ts`). DB integration tests: set `CRM_IT_DATABASE_URL` to a disposable DB. Report: `docs/crm/PHASE_02_LEADS.md`.
```
