# Sales & Marketing — Release 1 / S1 Enquiries (2026-10-28)

Spec: `ref/02.md` §5 (enquiries) and §7.1–7.3. Plan: `RELEASE_PLAN.md` (S1). Decision D1: the Sales Enquiry **is** the existing Buyer Enquiry — no second enquiry table.

## 1. Assessment (what existed, what was added)

| Need (02 §5) | Already there | Added in S1 |
|---|---|---|
| Reference, received date, source | `buyer_enquiries.enquiry_number` (ENQ-), `enquiry_date`, `source` enum | — |
| Customer or prospect, requesting person without a CRM record | `customer_id`/`buyer_id` or `prospect_*` fields (no auto-created records) | — |
| Requested products, qty, target price, delivery | `buyer_enquiry_lines` (Style or free text, colour, size, qty, target price, delivery) | — |
| Subject, owner, priority, follow-up date | — | `subject`, `owner_user_id`, `priority`, `next_follow_up_date` |
| Sales lifecycle | Merchandising `status` is derived from line sampling progress — a different thing | `sales_stage` (+ `stage_before_hold`, `stage_changed_at`, `closure_reason`, `closed_at`) |
| CRM company / contact | — | `crm_company_id`, `crm_contact_id` (reference only) |
| CRM opportunity | `crm_opportunity_erp_links` already supports doc type `BUYER_ENQUIRY` | reused — no column, links go through the CRM's own service |
| Qualification | — | `estimated_value`, `expected_decision_date`, `next_action`, `qualification_notes` (all optional) |
| Notes, interactions, history | CRM activities only cover CRM records | `buyer_enquiry_activities` (append-only timeline) |
| Attachments | shared record-attachments API | registered `BUYER_ENQUIRY` target |
| Notifications | `NotificationService` (in-app) | owner assignment notifies the new owner |
| Related quotations | no quotation module | S2 |

Merchandising is unchanged: its list, form, line review and Sample conversion work as before, and nothing in S1 writes its `status` or line statuses.

## 2. Lifecycle

`src/modules/sales-marketing/enquiries/sales-enquiry-registry.ts` is the single source.

- New → Under review → Qualified → *Quotation in progress → Quoted → Won*
- Any open stage → Lost / Not qualified (reason required) / On hold (reason optional)
- On hold → **Resume** returns to exactly the stage it was held from
- Lost / Not qualified → **Reopen** (reason required, audited) → Under review
- *Italic* stages are system stages: only the quotation and conversion services (S2–S4) set them. They can't be chosen by hand, so an enquiry is never "quoted" or "won" without the document behind it. Won is final.
- An enquiry cancelled in Merchandising is read-only in Sales & Marketing and drops out of the open list.
- Every stage write is guarded (`updateMany … where salesStage = <read> and updatedAt = <read>`): of two concurrent moves only one wins; the other gets `409 RECORD_VERSION_CONFLICT` or `INVALID_STATE_TRANSITION`.

## 3. Access

- `sales_marketing.view` → own, CRM-team and unassigned-created-by-me enquiries; `view_all` → all. Same rule as CRM records. Branch-restricted users see only their branches. Outside the scope = 404 (list, detail, attachments).
- `create` to capture, `edit` for stage / owner / details / notes / opportunity links. CRM company/contact links need `crm.view` and must be visible to the user in the CRM; opportunity links need `crm.edit` (the CRM service does its own checks too). CRM names are hidden from users without `crm.view`.
- Owners must be active users with `sales_marketing.view`.
- No new permissions: S1 uses the existing `sales_marketing` module (same roles as CRM). Whether quotations get their own module is an S2 decision.

## 4. What was built

| Area | Files |
|---|---|
| Migration | `prisma/migrations/20261028260000_sales_enquiries_s1` (3 enums, 15 nullable/defaulted columns on `buyer_enquiries`, `buyer_enquiry_activities`, 4 indexes). Existing enquiries start at New / Normal / no owner. Rollback: `prisma/rollback/20261028260000_sales_enquiries_s1.down.sql` |
| Service | `src/modules/sales-marketing/enquiries/sales-enquiry.service.ts`, `.schema.ts`, `-registry.ts`; `createBuyerEnquiry()` takes optional sales fields |
| API | `/api/v1/sales-marketing/enquiries` (GET list with filters, POST create), `/[id]` (GET, PATCH details), `/[id]/stage`, `/resume`, `/reopen`, `/assign`, `/activities` (GET, POST), `/opportunities` (POST), `/opportunities/[linkId]` (DELETE); `/api/v1/sales-marketing/owners` |
| Pages | `/sales-marketing/enquiries` (list: open/closed/all, stage, owner, priority, source, overdue, search, sort, paging), `/new` (Merchandising's form with a sales section), `/[id]` (status bar and actions, enquiry, qualification, requested items, CRM links, opportunities, attachments, timeline) |
| Navigation | sidebar leaf "Enquiries"; section map entry set to AVAILABLE |
| Attachments | `BUYER_ENQUIRY` in `src/core/attachments/attachment-targets.ts` (gated by `sales_marketing`, same visibility) |

List filter `overdue=1` = follow-up date before today, open stage, not cancelled.

## 5. Acceptance criteria

1. A user captures an enquiry for a customer or a prospect with lines, subject, owner, priority, follow-up and CRM company/contact; it gets an ENQ number and appears in Merchandising too.
2. Stage moves follow §2 on the server; system stages can't be set by hand; Lost / Not qualified / Reopen need a reason; Resume restores the held stage.
3. Owner change is logged and notifies the new owner; ineligible owners are refused.
4. Notes / calls / emails / meetings are logged with time and author (not in the future); every sales change adds a timeline row and an audit row.
5. Visibility follows `view` / `view_all` / team / branch everywhere, including attachments.
6. CRM links are validated (company, contact, customer agreement, CRM visibility); opportunities are linked through the CRM's link table and show in the CRM opportunity too.
7. Merchandising's status and line workflow are untouched.
8. Tests, type check, lint and build pass.

## 6. Verification (cloud sandbox copy, Postgres 16)

- Migration applied on the Phase 01 database; enum values match `schema.prisma`; down script restores a schema identical to the pre-migration dump; re-apply clean.
- `sales-enquiry.integration.test.ts` (real DB, 12 tests): create + defaults, owner notification and eligibility, own/team/all visibility incl. attachments, every list filter, stage machine with reasons / hold-resume / reopen / audit count, won not reopenable, cancelled read-only, concurrent close (one wins), detail edits logging only real changes, CRM link validation, opportunity link/unlink through the CRM table with hidden-count for users without CRM access, activity rules, Merchandising untouched. CRM opportunity and company integration suites re-run: 97 passed.
- Unit / route / component tests: registry ↔ Prisma enums and transition rules; route permissions, filter/sort/paging parsing, error mapping; detail screen actions per stage/permission, lost-with-reason flow, reassign-away redirect.
- Full suite: 3725 passed / 230 skipped; `tsc` 0 errors; `eslint` 0 errors (22 existing warnings); `next build` — see §7.
- Not run against the user's own database.

## 7. Known limits / follow-ups

- Merging two CRM companies/contacts does not re-point `buyer_enquiries.crm_company_id`/`crm_contact_id` (the CRM merge service doesn't know this table, and CRM code was not touched). The detail page marks a merged link "(merged — relink)".
- No CSV export of the enquiry list yet (`sales_marketing.export` exists; add with S6 reports).
- No new-line / edit-line for an existing enquiry from Sales & Marketing (Merchandising can't either). Quotations (S2) carry the priced lines.
- Enquiry numbers still come from the actor's branch counter (existing Buyer Enquiry behaviour); the per-branch counter vs company-unique number mismatch in CLAUDE.md applies.
- Owner list checks `sales_marketing.view` per user — fine for tens of users, not for thousands.
