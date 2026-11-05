# Sales & Marketing — Phase 08 Marketing foundation and campaign management (2026-11-04)

Spec: `ref/08.md`. Plan: `RELEASE_PLAN.md` (R3.1, R3.2, R3.4 widened). Scope confirmed 2026-11-04:

- **Core.** Campaign master (code, type and primary objective from configurable lists, owner, responsible department, Phase 07 sales channel, parent campaign, priority, planned vs actual dates, planned budget); lifecycle Draft → Pending approval → Approved → Active ⇄ Paused → Completed, or Cancelled, with history; approval by someone other than the preparer and **re-approval of plan changes** (dates, budget) through numbered revisions; success metrics with targets — system-measured where linked ERP records exist, otherwise clearly manual; activities & milestones; calendar; marketing overview; two reports.
- **Activities = CRM activities.** A campaign activity is a CRM task / call / meeting whose record is the campaign (new CRM record type `CAMPAIGN`). It appears in CRM My Tasks, the CRM calendar and its reminders. A milestone is a task flagged `milestone` in its metadata. No second task system.
- **Campaign links**: optional campaign on CRM lead, Sales Enquiry, Quotation and Sales Order. Quotation from an enquiry and order from a quotation copy it (like the Phase 07 channel); the order's value is authoritative and changing it needs a reason. Lead UTM text is not auto-matched.
- **Actual spend**: optional campaign on the existing **Expense**; approved / partly paid / paid expenses count as actual spend (amount before GST). Expenses stay in Accounts; the campaign page only links / unlinks them.

**Not in this phase:** audience segments (09), channel execution (10), assets (11), promotions & advanced budgets (12), attribution / ROI (13), collaborators, activity dependencies, scheduled auto-activation, campaign comparisons beyond the reports, secondary objectives.

## 1. What existed (reused, not rebuilt)

No campaign table (the old Marketing module was removed 2026-10-28; CRM leads keep free-text UTM / campaign-source fields only). Reused: CRM activities (tasks, reminders, My Tasks, calendar, `ActivityPanel`), Departments master, Phase 07 sales channels, Phase 05 `metricTotals()` booked / accepted / invoiced rules, Expenses with their approval workflow, `sales_performance_events` for status history (entity `CAMPAIGN`), audit log, notifications, `PermissionService` self-approval guard, Report Center.

## 2. Data model (migration `20261104150000_marketing_campaigns_phase8`)

| Table | Purpose |
|---|---|
| `marketing_campaign_lookups` | kind TYPE / OBJECTIVE, code, name, description, sort, active. Defaults are created per company the first time the lists are read; admins add / rename / deactivate. |
| `marketing_campaigns` | the campaign; code unique per company; `idempotency_key` unique per company (retried create returns the same campaign); `version` for optimistic locking; CHECK planned end ≥ start, actual end ≥ actual start, budget ≥ 0. |
| `marketing_campaign_revisions` | numbered plan revisions (planned dates, budget, budget notes, reason) with Pending approval → Approved / Rejected / Withdrawn; partial unique index = one pending revision per campaign. Revision 1 is the first submission. |
| `marketing_campaign_metrics` | success criteria: SYSTEM (`system_key` unique per campaign) or MANUAL (label, unit); target; manual actual with who / when. |
| `campaign_id` on `crm_leads`, `buyer_enquiries`, `quotations`, `sales_orders`, `expenses` | nullable FK, indexed. |
| `CrmEntityType.CAMPAIGN` | CRM activities on a campaign. |

Settings (`sales_marketing_settings`): `campaign_approval_required` (default true).

## 3. Lifecycle

| From | Action | To | Permission / rule |
|---|---|---|---|
| Draft | submit | Pending approval | `edit`; needs type, objective, owner, planned dates; creates revision n |
| Pending approval | approve | Approved | `approve`; approver ≠ creator / submitter (Super Admin excepted) |
| Pending approval | send back (reason) / return to draft | Draft | `reject` / `edit` |
| Approved | activate | Active | `edit`; actual start = today (or a given date ≥ planned start − 30 days, ≤ today) |
| Active | pause (reason) / resume | Paused / Active | `edit` |
| Active, Paused | complete | Completed | `edit`; actual end ≥ actual start, ≤ today |
| any open | cancel (reason) | Cancelled | `cancel` |
| Draft | delete | — | only with no links, activities or revisions |

When `campaign_approval_required` is off, submit approves at once (recorded as auto-approved). Status changes are events (`sales_performance_events`, entity `CAMPAIGN`) plus audit rows. Activating does **not** launch anything externally.

**Re-approval policy**: in Draft every field is edited directly. After the first approval, *planned dates and planned budget* change only through a new revision (proposed values + reason) that someone else approves; until then the campaign keeps the approved values. Name, description, type, objective, owner, department, channel, parent and priority stay editable (audited; owner changes recorded as events).

## 4. Metrics (§7 of the spec)

| System key | Measures | Source |
|---|---|---|
| LEADS | CRM leads with this campaign | `crm_leads.campaign_id` (created any time) |
| CONVERTED_LEADS | of those, converted | `converted_at` set |
| ENQUIRIES | Sales Enquiries with this campaign (not cancelled) | `buyer_enquiries.campaign_id` |
| ACCEPTED_QUOTATION_VALUE / _COUNT | accepted quotation revisions | Phase 05 rule, grouping CAMPAIGN on `quotations.campaign_id` |
| BOOKED_ORDER_VALUE / _COUNT | booked Sales Orders | Phase 05 rule, grouping CAMPAIGN on `sales_orders.campaign_id` |
| INVOICED_VALUE | posted invoices of those orders | Phase 05 rule |

Every record that carries the campaign is counted, up to today (the link is explicit, so no date window is applied). MANUAL metrics (e.g. booth visitors, responses) show "entered by … on …" and every change is audited; they are never labelled as measured. This is **linked-record counting, not attribution** (Phase 13).

## 5. Budget

Planned budget = approved planning figure (company currency). Actual = Σ `amount` (before GST) of linked expenses in Approved / Partly paid / Paid; pending-approval expenses shown separately; rejected / cancelled ignored. Remaining = planned − actual.

## 6. Permissions — new module `marketing_campaigns`

view (own: owner / creator / owner in the viewer's CRM team), view_all, create, edit, approve, reject, cancel, export. Grants: Super Admin all; Management all; Merchandiser view / create / edit / export; Viewer view. Lists (types / objectives) use `sales_marketing_settings.edit`. Activities follow CRM permissions (`crm.*`): a user without CRM access sees the campaign but not its task panel. Linking a lead needs `crm.edit` and CRM visibility; enquiry `sales_marketing.edit`; quotation `sales_quotations.edit`; order `sales_performance.edit` + reason; expense `marketing_campaigns.edit` + `expenses.view`.

## 7. Screens and reports

- **Sales & Marketing → Campaigns**: marketing overview (counts by status, awaiting approval, starting in 30 days, past planned end, overdue activities, campaigns missing a target or budget, planned budget total) + filtered list.
- Campaign detail: details, lifecycle actions, revisions / approvals, metrics, budget with linked expenses, activities & milestones (CRM panel), linked leads / enquiries / quotations / orders, history.
- **Campaign calendar**: month view of campaigns (planned and actual bars) and their activity / milestone due dates; filters owner, status, type.
- Settings: campaign types and objectives.
- *Campaign* panel on CRM lead, enquiry, quotation and Sales Order pages.
- Reports: *Campaign Register* (status, dates, owner, budget planned / actual) and *Campaign Results* (target vs actual per metric, with source).

## 8. Code map

| Area | Files |
|---|---|
| Schema | `prisma/migrations/20261104150000_marketing_campaigns_phase8/` (rollback `prisma/rollback/20261104150000_marketing_campaigns_phase8.down.sql`) |
| Registry (client-safe) | `src/modules/sales-marketing/campaigns/campaign-registry.ts` — statuses, actions, system metric catalogue, default lists, event labels |
| Services | `campaigns/campaign-common.ts` (visibility, events, approver checks), `campaign-lookup.service.ts`, `campaign.service.ts` (create / edit / delete, lifecycle, plan revisions, list), `campaign-results.service.ts` (metrics, budget & expense links, linked records, milestones, detail, overview, calendar), `campaign-link.service.ts` (campaign on lead / enquiry / quotation / order); defaults flow in `quotation.service.ts` and `sales-credit.service.ts#resolveDefaultChannel`; `performance-actuals.ts` grouping `CAMPAIGN` |
| CRM integration | `CrmEntityType.CAMPAIGN`: `crm/core/crm-entity-types.ts`, `crm/activities/activity-registry.ts` (`ACTIVITY_PARENT_TYPES`), `crm-activity.repository.ts#records`, `crm-activities.service.ts#recordInfo`, `crm/crm-entity-access.ts` (campaign visibility), appointments refuse campaigns |
| APIs | `/api/v1/sales-marketing/campaigns` (+ `overview`, `calendar`, `options`, `lookups`, `lookups/[id]`, `[id]`, `[id]/[action]`, `[id]/plan-changes`, `[id]/plan-changes/[revisionId]/[action]`, `[id]/metrics`, `[id]/metrics/[metricId]`, `[id]/metrics/[metricId]/result`, `[id]/expenses`, `[id]/expenses/[expenseId]/unlink`, `[id]/milestones`); `/api/v1/sales-marketing/campaign-links/[lead|enquiry|quotation|order]/[id]` |
| Screens | `/sales-marketing/campaigns` (overview + list), `/new`, `/[id]`, `/[id]/edit`, `/calendar`, `/settings`; *Campaign* panel (`components/sales-marketing/campaigns/CampaignLinkPanel.tsx`) on CRM lead, enquiry, quotation and Sales Order pages; setting *Campaign plans need approval* in Sales & Marketing → Settings |
| Reports | `src/modules/reports/marketing-campaigns.reports.ts` — *Campaign Register*, *Campaign Results* |
| Tests | `campaigns.integration.test.ts` (7, real DB), `api/v1/sales-marketing/campaigns/routes.test.ts` (4), `components/sales-marketing/campaigns/campaign-screens.test.tsx` (5); CRM registry test updated for `CAMPAIGN` |

## 9. Limitations (known, not built)

- No collaborators list, activity dependencies, secondary objectives, scheduled auto-activation or campaign-to-campaign comparison screen (reports only).
- Campaign activities need CRM access (they are CRM tasks); the responsible person must be a CRM user.
- Measured metrics are linked-record counts, not attribution: a lead / enquiry / order counts for the campaign it carries, whatever else influenced it (Phase 13).
- Spend comes from linked Expenses only (not purchase invoices or payment requests); linking happens on the campaign page, not on the Expense form.
- The "Campaign" field on a lead isn't matched from its free-text UTM campaign.
- Changing a running campaign's planned start through a revision is allowed (it's a plan figure); the actual start is never changed by it.

## 10. Verification (sandbox, 2026-11-04)

- Type-check: clean, run as four slices (`tsconfig.check-{a,b,d,e}.json`, sandbox only — the single full `tsc` is now killed by the sandbox's memory limit). ESLint 0 errors (22 pre-existing warnings). `next build` compiles every route (type-check step skipped in the build for the same memory reason; config restored).
- Tests: Phase 08 integration 7/7 (real Postgres: idempotent create, unique code, visibility, self-approval refused, re-approval of budget / dates, lifecycle date rules, lead / enquiry → quotation → order campaign flow, measured vs manual metrics — leads 1 of 10, enquiries 1 of 5, accepted ₹3,000 of ₹10,000, booked ₹2,500 of ₹5,000, booth visitors 240 of 300 — expenses ₹30,000 spent / ₹12,000 pending / ₹50,000 left, milestones as CRM tasks, cancel). Routes 4/4, screens 5/5. Full suite: everything else green except the long-standing CRM workflow / bulk-action integration failures — found to be the **test database's** backlog of thousands of old workflow events and queued executions (accumulated over many runs; the dispatcher reads 200 at a time). After clearing that backlog in the test DB, the workflow tests pass; the bulk-action one still hits its 5 s timeout under load. The company-scoping contract test flagged `updateCampaign` / `updateMetric`; both now check the company explicitly.
- Live (browser, dev DB): created *Winter trade fair 2026* through the form (code suggested from the name), added Leads / Booked order value / Booth visitors metrics, submitted, approved, activated (actual start 2 Nov), added milestone *Stand design approved* (due 3 Nov → shown overdue on 4 Nov, also in CRM My Tasks and on the calendar), requested a budget change ₹75,000 → ₹90,000 (kept ₹75,000 until approved, then ₹90,000), linked ORD-2026-00001 with a reason (booked ₹2,760 = 27.6 % of the ₹10,000 target), created and approved a real expense EXP-2026-00001 (₹12,000) through Expenses and linked it (remaining ₹78,000). Campaign Register and Campaign Results agree. No console errors. A bug found here and fixed: milestone / calendar due dates were shown in UTC (a day early); they now use the CRM business time zone and the CRM overdue rule.
- Rollback rehearsal on a copy of the dev DB: down script removes the 4 tables and the 5 `campaign_id` columns; the migration re-applies cleanly (13 permission rows).
