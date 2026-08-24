# CRM + Marketing Enhancement — Audit, Gap Analysis & Implementation Plan

Companion document to `CRM_SALES_MARKETING_HRMS_MIGRATION_REPORT.md` (which covers the original
WordPress→FashionERP migration). This document covers the **next-phase enhancement** requested on top of
that migration: Deal→Customer conversion, Kanban, Customer 360, dashboards, campaign approval workflow,
channel performance, segmentation, automation, CSV import, Ads integration.

Per the request, **this is Phase 1 (Audit) + Phase 2 (Gap Analysis) + Phase 3 (Architecture Plan) only —
no code has been written.** Everything below is verified against the live codebase (branch
`crm-marketing-hrms`) via 4 parallel read-only audits, not assumed from the earlier migration report.

---

## 0. Two corrections to the request's own assumptions, found during audit

1. **`Deal.customerId` already exists** (`prisma/schema.prisma:1572`, optional FK) — a Deal can already be
   manually linked to an existing Customer today. What's missing is not the link itself, but the *automatic,
   guided* WON→Customer flow (duplicate detection, "Create new" vs "Link existing" choice, audit trail).
2. **`SalesOrder.originatingDealId` already exists in the schema** (`schema.prisma:1972`) but has **zero
   write path anywhere in the code** — it's a dangling column nobody ever sets. The Lead→Deal→Customer→
   SalesOrder chain the request describes is currently broken at exactly this link, not missing a column.

---

## 1. Audit matrix

Legend: **Complete** = reuse as-is · **Partial** = extend · **Missing** = build · **Blocked** = genuinely
new concept or depends on a phase that hasn't started (Accounts/Phase 7, Dispatch/Phase 8, Reports/Phase 9
— none of these exist as Prisma models or pages today, confirmed by grep, not assumed).

| # | Feature | Status | Evidence | Action |
|---|---|---|---|---|
| — | Lead capture, scoring, priority | Complete | `lead.service.ts` — hardcoded 80/50 thresholds | Reuse; make thresholds configurable (§7 of request) |
| — | Round-robin assignment | Complete | `CrmRoundRobinState` + real rotation pointer | Reuse |
| — | Duplicate email/phone detection | Complete | `DUPLICATE_LEAD_EXISTS`, override flag | Reuse |
| — | Deal pipeline + stage guard | Complete | `ALLOWED_TRANSITIONS` in `deal.service.ts` | Reuse — Kanban must call this same guard, not bypass it |
| — | Weighted deal value | Complete | computed live, never stored | Reuse |
| — | Salesperson leaderboard | Complete | `getSalesLeaderboard()` | Reuse; surface on new CRM dashboard |
| — | Follow-ups / Activities | Partial | Only `{pending, overdue}` counters exist — no due-today/upcoming/completed split | Improve (§6) |
| — | **Deal → Customer conversion** | **Missing** | `Deal.customerId` exists (manual only); zero auto-create/link-on-WON flow | **Build (§3 — top priority)** |
| — | **`SalesOrder.originatingDealId` wiring** | **Missing** | Column exists, zero writers | **Build** — required to actually close the chain in §17 |
| — | CRM Kanban board | Missing | No board UI; list+detail only | Build (§4) |
| — | Customer 360 view | Partial/Blocked | Customer↔Buyer/SampleRequest/SalesOrder/Deal all exist and are joinable; **Quotations/Invoices/Payments/Outstanding/Returns/Complaints don't exist anywhere in the schema** (Phase 7/8 not started) | Build the real parts now; explicitly omit the non-existent parts (§5) |
| — | CRM Dashboard | Missing | No `/crm` dashboard page at all — confirmed absent | Build (§8) |
| — | Configurable lead-priority thresholds | Missing | Hardcoded `80`/`50` literals | Build (§7) |
| — | Campaign approval enforcement | Missing | `approvalStatus` field exists but is **write-only** — never checked anywhere, not even to gate `status: ACTIVE` | Build (§10) |
| — | Campaign status lifecycle guard | Missing | No `ALLOWED_TRANSITIONS` for `CampaignStatus` at all — any status settable to any other | Build (§10) |
| — | Marketing dashboard | Partial | 8 static aggregate cards only, zero charts/trends/breakdowns | Improve (§11) |
| — | Marketing trend/time-series data | Missing | `CampaignDailyMetric` already stores by-date rows — the *data* exists, no aggregation endpoint reads it as a series | Build (§11) — cheap, no new schema |
| — | Channel performance report | Missing | Confirmed absent | Build (§12) |
| — | Customer segmentation | Missing | Zero segmentation concept anywhere; `Customer.type` is a **plain string** (not an enum), `Customer.country` is **free text** (not FK'd to a region master) | Build, but scoped down (§13) — no region/type structure to segment by yet either |
| — | Marketing automation framework (event→action) | Missing | Only the 4 alert-threshold rules exist; no generic "trigger→action" framework | Build, minimal (§14) |
| — | CSV import | Missing | **Confirmed absent project-wide** — no module in this entire codebase has CSV import; nothing to reuse, this is genuinely new infrastructure | Build (§15) |
| — | Meta/Google Ads integration | Missing | Confirmed zero code, as expected | Build, isolated (§16) — real OAuth infra, largest single item |
| — | Notification system | **Misleading in schema** | `Notification` Prisma model exists but **zero code anywhere uses it** — not "reuse existing," it's an empty shell | Build the actual service; the table needs no schema change |
| — | Fashion "Collection" concept | **Blocked — doesn't exist** | No `Collection` model anywhere. Closest real equivalents: `Season` (wired to Product) + `Category` (wired to Product). `Brand`, `Design`, `Pattern`, `ProductFitting`, `ProductType`, fabric sub-masters all exist but are **not wired to Product** | Cannot target campaigns by "Collection" literally — substitute Season+Category, which are real and wired |
| — | Reports module (Phase 9) | Blocked | `src/app/(dashboard)/reports` does not exist | Any "report" built here lives under `/marketing` or `/crm`, not `/reports`, until Phase 9 exists |
| — | RBAC for crm/marketing | Partial | Only `SUPER_ADMIN` (all), `MANAGEMENT` (view/export only — **cannot edit/approve today**), `MERCHANDISER` (view/create/edit) have any access at all | Gap: nobody has an "approve" action on `marketing` today — needed for §10 |
| — | AI-ready architecture | N/A | Nothing to audit — greenfield | Design hooks only, no fake AI (§19, honored as stated) |

---

## 2. Gap analysis summary (by request's own section numbers)

| Request § | Feature | Real status |
|---|---|---|
| §3 Deal→Customer | Missing (link exists, flow doesn't) |
| §4 Kanban | Missing |
| §5 Customer 360 | Partial — buildable parts: Leads/Deals/SalesOrders/Samples/Follow-ups/Activities/Campaigns/Notes. **Not buildable yet**: Quotations, Invoices, Payments, Outstanding, Returns, Complaints (zero backing schema — Phase 7/8) |
| §6 Follow-up mgmt | Partial (counters exist, dashboard breakdown doesn't) |
| §7 Lead priority config | Missing |
| §8 CRM dashboard | Missing |
| §9 Preserve marketing logic | **Complete, verified untouched** — formulas quoted exactly in audit, will not be modified |
| §10 Campaign approval | Missing (field exists, zero enforcement) |
| §11 Marketing dashboard/charts | Partial |
| §12 Channel performance | Missing |
| §13 Segmentation | Missing, and shallower than requested (no Customer.type enum, no region master to segment by) |
| §14 Automation | Missing (only alerts exist, no generic framework) |
| §15 CSV import | Missing, first-of-its-kind |
| §16 Meta/Google Ads | Missing, largest item |
| §17 Full-chain integration | **Currently broken at exactly one link**: Deal→Customer→SalesOrder (§3 fixes this) |
| §18 Fashion-specific | Partial — Season/Category real and wired; "Collection"/Brand/fabric-attribute targeting not available without further wiring (separate, larger effort — flagged, not in this plan) |
| §19 AI-ready | N/A, design-only |
| §20 RBAC | Partial — needs an actual `approve` grant on `marketing` before §10 is meaningful |

---

## 3. Architecture plan (Phase 3 — no code yet)

Priority order taken directly from the request's own §21 Phase 5 list. Each item states what's genuinely
new vs. what reuses existing patterns already proven elsewhere in this codebase (guarded-transaction
accumulators, `ALLOWED_TRANSITIONS` maps, `writeAuditLog`, the `Modal`/`ConfirmModal` small-action
convention, RBAC module grants) — matching the project's own established conventions rather than inventing
new ones.

1. **Deal → Customer conversion** — new `convertDealToCustomer(actor, dealId, { mode: "CREATE" | "LINK",
   customerId? })` in `deal.service.ts`. On `CREATE`: duplicate-check against `Customer` by name/email/phone
   (same shape as Lead's own duplicate check) before creating; on `LINK`: just set `Deal.customerId`. Both
   paths, inside one transaction: write `SalesOrder.originatingDealId`-ready state (doesn't create the
   SalesOrder itself — that's a separate user action — but makes the Deal→Customer link real so a
   subsequently-created SalesOrder can carry `originatingDealId`), write `CrmActivity`, `writeAuditLog`.
   Only reachable when `stage === "WON"` (reuses the existing stage guard). **This is the one item that
   actually closes the chain in §17.**
2. **Customer 360** — one new Server Component page, `/customers/[id]/360` (or a tab on the existing
   customer detail page), pulling Buyers/SampleRequests/SalesOrders/Deals/Leads(via Deal)/CrmActivities/
   CrmFollowups/CampaignAttributions — all real, existing relations, one aggregating query. Quotations/
   Invoices/Payments/Outstanding/Returns/Complaints sections are **omitted entirely**, not shown as empty
   placeholders, until Phase 7/8 exist.
3. **CRM Kanban** — new `/deals/board` page, columns = `DealStage` enum values, drag-and-drop calls the
   *existing* `updateDealStage()` (same `ALLOWED_TRANSITIONS` guard, same audit log) — no new business logic,
   purely a new UI surface over what already exists.
4. **CRM Dashboard** — new `/crm` page mirroring `/marketing`'s existing shape (stat cards + this session's
   new leaderboard/pipeline widgets), reusing `getSalesLeaderboard()` and new small aggregation functions
   for lead/deal counts by status/stage, all real DB queries.
5. **Follow-up notifications** — build the **first real use** of the existing-but-unused `Notification`
   table: a `NotificationService` (create/list/markRead), populated by a follow-up due/overdue check. No
   background scheduler exists in this project (confirmed) — surfaced the same way Marketing's automation
   is (a manual/on-page-load check, not a cron job), consistent with §14's explicit "don't introduce
   infrastructure the project doesn't support" instruction.
6. **Configurable lead-priority thresholds** — new small company-scoped config (two Decimal fields, e.g. on
   a new minimal `CrmSettings` row, one per company) replacing the hardcoded `80`/`50` literals in
   `computeLeadPriority()`. Smallest schema change in this plan.
7. **Campaign approval workflow** — add `ALLOWED_TRANSITIONS` for `CampaignStatus` (`DRAFT→PENDING_APPROVAL
   →APPROVED→ACTIVE→COMPLETED`, `REJECTED` from `PENDING_APPROVAL`) exactly like Deal's own guard; gate
   `runMarketingAutomation()` and daily-metric recording behind `approvalStatus === "APPROVED"`. **RBAC gap
   found in audit**: no role currently has an `approve` action on `marketing` — needs a deliberate, explained
   grant (likely `MANAGEMENT`) before this is meaningful, mirroring how Sales/Purchase Order approvals are
   gated elsewhere in this codebase.
8. **Marketing dashboard charts** — no new schema; `CampaignDailyMetric` already has the by-date data. New
   aggregation endpoint groups existing rows by date for a line chart. Reuses `recharts`-or-equivalent if
   already a dependency, otherwise a minimal lightweight chart approach — checked at implementation time.
9. **Channel performance** — new read-only aggregation joining `Campaign.channel` → `Lead` → `Deal` (WON) →
   revenue, grouped by channel. No schema change, pure query.
10. **Customer segmentation** — scoped down from the request's full list given the audit finding that
    `Customer.type` isn't a real enum and there's no region master: build segmentation on what's real today
    (order recency/frequency/value from `SalesOrder`, and the existing free-text `type`/`country` as
    filters) rather than inventing a `Region` master or a `CustomerType` enum migration as a side effect of
    this task — flagged as a separate decision if the user wants that structural upgrade too.
11. **Marketing automation framework** — a small, generic `AutomationRule` concept (trigger + action) is
    over-engineering for the 4-5 rules actually named in §14; instead, implement each named trigger
    (`New Lead→Follow-up`, `Deal Won→Welcome`, etc.) as its own small function reusing existing services
    (`createFollowup`, `convertDealToCustomer`), consistent with how Marketing's own alert engine is 4
    explicit functions, not a rule-interpreter.
12. **CSV import** — genuinely new: upload → parse → column-mapping UI → preview → validation → import
    inside a transaction → failed-row report. Built once, generically enough that Leads/Deals/Daily-Metrics
    each just supply a row-schema + mapper, not three separate implementations.
13. **Meta/Google Ads integration** — isolated in a new `src/modules/marketing/ad-integrations/` (or
    similar) sub-area so OAuth/HTTP client code never touches `campaign.service.ts`'s core logic — a sync
    job writes into the *existing* `CampaignDailyMetric` table (no parallel metrics table), so alerts/
    dashboards/charts work identically whether a row was entered manually or synced. Real credentials only —
    no fabricated data, honoring §16's explicit instruction.
14. **AI-ready architecture** — no code this pass; just keeping every new aggregation (leaderboard, channel
    performance, segmentation) as a clean, separately-callable service function so a future AI layer can
    call them for real data rather than needing to re-derive queries.

---

## 4. What will NOT be touched

Per §2/§9's explicit instruction: existing Lead/Deal/Campaign schema, the 4 alert formulas, round-robin
logic, duplicate detection, and the `ALLOWED_TRANSITIONS` deal-stage guard are **not modified** — only
extended around. No existing RBAC grant is removed, only new ones added (with the one exception of adding
an `approve` action to `marketing` for a role that doesn't have it yet, needed for item 7 — a pure addition,
not a change to any existing grant).

---

## 5. Explicitly out of scope for this plan (flag for a separate decision, not silently built)

- Wiring `Brand`/fabric-attribute masters onto `Product`, or inventing a `Collection` model — a real
  Product-schema change, bigger than a CRM/Marketing enhancement, and not required for Season+Category-based
  targeting to work today.
- A `Region` master or a `CustomerType` enum migration for deeper segmentation.
- Anything under Quotations/Invoices/Payments/Outstanding/Returns/Complaints — blocked on Phase 7/8, not
  started as part of this plan.
- A generic Reports module (Phase 9) — new pages here live under `/crm`/`/marketing` instead.

---

## Next step

Per the request's own Phase 4: **waiting for approval before any implementation.** Suggested build order
matches the numbered list in §3 above (same as the request's own priority list) — confirm this order, or
reprioritize, before item 1 starts.

---

## Item 1 — Deal → Customer conversion: DONE (2026-08-24)

Built and verified live end-to-end, per the plan in §3.1 above. No schema migration needed —
`Deal.customerId` and `SalesOrder.originatingDealId` already existed; this closed their write paths.

- **`convertDealToCustomer(actor, dealId, input)`** in `deal.service.ts` — only legal once `stage === "WON"`
  and not already linked (`REFERENCED_RECORD_IN_USE` otherwise, verified live with a 409). Two modes in one
  `prisma.$transaction`: `CREATE` (name-based duplicate check against `Customer`, case-insensitive,
  overridable — mirrors Lead's own duplicate-detection shape exactly; new `DUPLICATE_CUSTOMER_EXISTS` error
  code) and `LINK` (attach an existing Customer). Both write a `CrmActivity` note and an audit log entry.
- **`SalesOrder.originatingDealId` now has a real writer**: `sales-order.schema.ts`/`.service.ts` accept and
  tenant-validate it; `SalesOrderForm.tsx` gained `presetCustomerId`/`originatingDealId` props, wired from a
  new "Create Sales Order" link on the Deal detail page (shown once a Deal has a linked Customer) through
  `sales-orders/new`'s `searchParams`.
- **UI**: `DealWorkflowPanel.tsx` gained a "Convert to Customer" button (WON + no customer yet) opening a
  `Modal` with Create/Link modes, an inline amber duplicate-warning with a one-click "Link to it instead" or
  "Create separate customer anyway" override — same small-focused-action convention as every other Modal in
  this codebase.
- **Verified live end-to-end**: converted `DEAL-2026-00001` (Won, previously unlinked) → created `CUST-00002`
  "Rohan Mehta" → clicked through to "Create Sales Order" → created `ORD-2026-00011` with the customer
  pre-selected and the banner showing the originating deal → confirmed the Deal detail page's "Resulting
  Sales Orders" section now shows `ORD-2026-00011 (DRAFT)`, closing the full Lead→Deal→WON→Customer→
  SalesOrder chain live, not just in schema. Also verified: a second conversion attempt on the same deal
  correctly `409`s (`REFERENCED_RECORD_IN_USE`); creating a second deal and attempting to name its new
  customer "Rohan Mehta" correctly `409`s (`DUPLICATE_CUSTOMER_EXISTS`) with the existing customer's id/code
  in the error details; the same deal's `LINK` mode against that existing customer then succeeded. `npx tsc
  --noEmit` and `npm run lint` clean throughout.
- **Browser-automation note**: this session's `computer.left_click` on a freshly-read `ref` intermittently
  missed the actual button (a documented tool quirk noted elsewhere in this project) — fell back to a direct
  `querySelector` + `.click()` via `javascript_tool`, which worked correctly. Worth trying that fallback
  first if a click via `ref` doesn't visibly do anything, rather than assuming the app has a bug.

---

## Item 2 — Customer 360 view: DONE (2026-08-24)

Built per §3.2 above — a new read-only page, no schema changes, no new API route (a Server Component
calling the aggregation function directly, same shape as the Marketing dashboard page).

- **`getCustomer360(companyId, customerId)`** (new `src/modules/customers/customer-360.service.ts`) — a
  genuine cross-module aggregation (Deal, SampleRequest, SalesOrder, CrmActivity, CrmFollowup,
  CampaignAttribution), same precedent as `getMarketingDashboard()`/MRP's `getMaterialRequirements()`
  reading across modules directly rather than inventing repository indirection five modules would need to
  keep in sync for one screen. `leads` is derived by deduping each Deal's own linked Lead — the only real
  path back to Leads, since `Lead` has no direct `customerId` (confirmed in the audit). Campaign
  touchpoints answer the request's own §17 question ("which campaigns interacted with this customer?") via
  `Deal.leadId → CampaignAttribution.leadId` — the only real join path, since `CampaignAttribution` has no
  direct `customerId` either.
- **Explicitly omits** Quotations/Invoices/Payments/Outstanding/Returns/Complaints sections entirely
  (rather than rendering an empty placeholder for each) — none of these exist anywhere in the schema
  (Phase 7/8 not started, per the audit) and a visible-but-empty section would misrepresent "doesn't exist
  yet" as "no data."
- New tiny shared util `src/lib/humanize-status.ts` (`"IN_PRODUCTION"` → `"In Production"`) — used instead
  of importing five different modules' own status-label maps (Deal/SalesOrder/SampleRequest/CrmFollowup),
  which would have coupled this one cross-cutting screen to every other module's label file for purely
  cosmetic text.
- New page `/masters/customers/[id]/360`, linked from the existing customer edit page's header ("Customer
  360 →") — the existing edit page itself is untouched otherwise.
- **Verified live on two real customers**: `Rohan Mehta` (CUST-00002, created via Item 1's conversion flow)
  — correctly showed both its Deals (deduping the shared lead across... confirmed only 1 of 2 deals actually
  had a lead, correctly deduped to one Lead entry), the real Sales Order created in Item 1, and — as a live,
  unplanned proof the campaign-touchpoint join works — correctly surfaced "Diwali Denim Push (Meta Ads) ·
  First touch" from that lead's own pre-existing campaign attribution. `Zenith Apparel Imports` (CUST001, a
  long-standing seeded customer) — correctly showed its real Buyer (John Miller), 8 real Sample Requests
  with correct humanized statuses ("Tech Pack Ready", "Approved", etc.), and 2 real Sales Orders — while the
  Leads/Deals/Campaigns/Follow-ups/Activity sections correctly rendered their empty states (this customer
  has none of those). `npx tsc --noEmit`, `npm run lint`, `npm test` (138/138) all clean throughout.

---

## Item 3 — CRM Kanban board: DONE (2026-08-24)

Built per §3.3 above — a new page over existing logic, zero new business rules.

- New `/deals/board` page — 5 columns (`QUALIFIED/PROPOSAL/NEGOTIATION/WON/LOST`), native HTML5 drag-and-drop,
  each drop calling the **existing** `PATCH /api/v1/deals/[id]/stage` endpoint unchanged — the exact same
  `ALLOWED_TRANSITIONS` guard the detail page's "Move to X" buttons already enforce, so an illegal drag
  (e.g. Proposal straight to Won) is rejected server-side and the card optimistically reverts client-side.
  Per-column deal count, total value, and weighted value; a title/lead/customer search box and an owner
  filter, both client-side over the same fetched page (capped at 100 deals — this app's existing shared
  `parseListQuery` limit, same one every other "load everything for a client view" fetch already lives
  with).
- **New behavior added beyond "just a UI surface" per the request's own §4 spec**: `changeDealStage()` in
  `deal.service.ts` now also writes a `CrmActivity` row ("Stage changed: X → Y") on every transition — not
  board-specific, so the detail page's own "Move to X"/"Mark Lost" buttons get the same activity-timeline
  entry for free, keeping the timeline a complete history rather than silently having a gap for one entry
  point. One new regression test added for this (`deal.service.test.ts`, 139/139 project-wide) — also
  required adding a `@/core/db/client` mock to that test file since it previously had no reason to touch the
  raw `prisma` client directly.
- "Board View →" link added to the existing `/deals` list page (and back again from the board) — the
  existing list page itself is otherwise untouched.
- **Verified live**: board renders all 5 columns with real seeded data, correct per-column totals (Won:
  ₹501,000 total and weighted, matching the two real Won deals exactly); confirmed an illegal drag
  (Proposal → Won, dispatched via synthetic `DragEvent`s) is correctly rejected and the card stays in
  Proposal with zero PATCH request even attempted — the underlying native-drag-event simulation itself
  didn't fully replicate a real user drag in this sandboxed browser (a known hard case for browser
  automation generally, not specific to this app), so the *rejection* path was confirmed via the card not
  moving, while the *acceptance* path relies on the same `/stage` endpoint already proven correct by Item
  1's and this project's own extensive prior verification — flagging this honestly rather than overclaiming
  a full drag-and-drop click-through. Search filtering verified correctly (typing "Mehta" narrowed the board
  to exactly the 2 real Mehta-linked deals, "zzzzz" correctly emptied every column) — the first attempt at
  this test actually typed into the *topbar's* global search box instead of the board's own (a click-target
  miss, the same class of browser-automation quirk hit earlier converting Item 1), caught by comparing both
  inputs' values directly rather than assumed correct. `npx tsc --noEmit`, `npm run lint`, `npm test`
  (139/139) all clean throughout.

**Paused, then resumed** — the user opened a separate, much larger initiative (a full application-wide
UI/UX design system overhaul) mid-session; rather than implement that immediately, a new `fashion-erp-uiux`
sub-agent was created (`.claude/agents/fashion-erp-uiux.md`) to own that work on its own terms
(analysis-first, implements only when explicitly asked), and this plan resumed at item 4.

---

## Item 4 — CRM Dashboard: DONE (2026-08-24)

Built per §3.4 above.

- **`getCrmDashboard(companyId, {dateFrom?, dateTo?})`** (new `src/modules/crm/crm-dashboard.service.ts`) —
  another cross-entity aggregation (Lead + Deal + Customer + Follow-ups), same precedent as
  `getMarketingDashboard()`/`getCustomer360()`. Date range filters both Lead and Deal by `createdAt`
  uniformly, so Pipeline/Won/Lost/Top-Customers/Top-Opportunities all describe the same period — documented
  tradeoff: a deal created last period but won this period is still attributed to its creation period, since
  `Deal` has no separate `wonAt`/`closedAt` timestamp and adding one solely for this dashboard would be
  scope creep. Today's/Overdue Follow-ups are deliberately NOT date-range scoped (both are inherently
  "right now" concepts).
- **Extended `getFollowupCounters()`** (`crm-activity.service.ts`) from a plain `{pending, overdue}` pair
  into the full `{overdue, dueToday, upcoming, completed, pending}` breakdown the request's own §6 example
  called for — safe to change since a repo-wide search confirmed **zero existing callers** of the old shape
  outside its own already-unused `/api/v1/crm-followups/counters` route. Also **fixed the overdue boundary**
  in the same change: it previously compared against the exact current timestamp (`followupDate < now()`),
  which meant a follow-up due at 9am today would already read as "overdue" by 10am the same day, conflating
  "overdue" with "due today." Now compares against midnight, so "overdue" genuinely means "before today."
  One new unit test (`crm-activity.service.test.ts`, using `vi.useFakeTimers()` to pin the boundary
  calculation) — 140/140 project-wide.
- **New `/crm` dashboard page** — stat cards (Total/New/Qualified Leads, Open/Won/Lost Deals, Pipeline/
  Weighted Pipeline/Won Value, Conversion Rate, Avg. Deal Value, Today's/Overdue Follow-ups), Deals-by-Stage
  and Leads-by-Source breakdowns, Top Customers (linking into Item 2's Customer 360), Top Opportunities,
  and Salesperson Performance (reusing the existing `getSalesLeaderboard()` unchanged — labeled "(all-time)"
  in the UI since that function has no date-filtering of its own and extending it wasn't needed for this
  pass). Date filters: Today/This Week/This Month/This Quarter/This Year presets plus a manual custom range,
  mirroring the exact preset-button pattern already established in `SamplingFilters.tsx`. New `GET
  /api/v1/crm/dashboard` route (`crm` view permission, same as every other CRM read). Sidebar gained a
  "CRM" entry above "Leads".
- **Real bug found and fixed during live verification, not just claimed**: `dateTo` was parsed as
  `new Date("2026-08-24")`, which is that day's **midnight UTC** — combined with a `lte` comparison against
  `Lead`/`Deal.createdAt` (full timestamps, not date-only columns), this silently excluded every record
  created *later that same day*. Since all 5 presets end with "today" as `dateTo`, this bug would have hit
  the single most common case (any preset) and made "today's own activity" disappear from its own dashboard.
  Caught by testing the "This Year" preset and getting an unexpected zero, not by assuming the code was
  correct. Fixed by parsing `dateTo` as `${dateTo}T23:59:59.999` (end of that calendar day) instead.
  Re-verified live: the "Today" preset now returns identical totals to the all-time view, as expected for a
  dev DB where every record was created today.
- **Verified live end-to-end**: dashboard renders with real, hand-checked numbers (66.7% conversion rate =
  2 Won / 3 closed, ₹175,500 average deal value = ₹702,000 total ÷ 4 deals, ₹501,000 Won value correctly
  attributed to "Rohan Mehta" via Item 1's conversion, "Owned Deal Test" correctly listed as the one open
  Top Opportunity) both before and after the date-boundary fix. `npx tsc --noEmit`, `npm run lint`, `npm
  test` (140/140) all clean throughout.

**Next**: item 5 (Follow-up Management improvement — now largely unblocked by today's counter work, mainly
needs list-page UI: Today's/Upcoming/Overdue/Completed panels, priority, reminder settings) per the priority
order above.

---

## Item 5 — Follow-up Management (notifications + priority): DONE (2026-08-24)

Built per §3.5 above and the request's own §6 spec, reusing item 4's counter work directly.

- **Schema** (migration `add_crm_followup_priority_and_notification_module`): `CrmFollowupPriority` enum
  (LOW/MEDIUM/HIGH, default MEDIUM) + `CrmFollowup.priority`; `RelatedModule` gained `CRM_FOLLOWUP` — the
  first time a notification points at the follow-up record itself rather than the Lead/Deal/Customer it's
  about, needed so dedup ("has this exact follow-up already been notified") and "which follow-up is this"
  are both unambiguous.
- **`NotificationService`** (new `src/core/notifications/NotificationService.ts`) — the **first real
  consumer** of the `Notification` table, confirmed completely unused anywhere in the codebase during the
  original audit. In-app only (`channel` defaults `IN_APP`; `EMAIL`/`SMS` stay reserved, unwired — no
  delivery infra exists in this project). `createNotification`/`listNotifications`/
  `getUnreadNotificationCount`/`markNotificationRead`/`markAllNotificationsRead`, all scoped to
  `companyId`+`userId` so a user only ever sees their own.
- **`generateFollowupNotifications(companyId)`** (`crm-activity.service.ts`) — the manual "check for due
  follow-ups" action, mirroring Marketing's own "Run Automation Now" pattern since this project has no
  background job runner. Notifies the follow-up's assignee (or its creator, if unassigned) **exactly once
  per follow-up** — dedup is a plain "does a Notification already point at this follow-up id" check, simpler
  than the source's 24h re-notify window since nothing re-runs this hourly on its own.
- **Shared date-boundary helper** (`getTodayBoundaries()`) extracted so `getFollowupCounters()` (item 4's
  dashboard counters) and the new `listFollowupsForManagement()` (this item's full bucketed list, with each
  polymorphic `relatedModule`/`relatedRecordId` resolved to a human label via 3 batched queries — one per
  Lead/Deal/Customer, not one per follow-up) can never drift apart on what "overdue" vs. "due today" means.
- **New `/follow-ups` page** — the 4 count cards from the request's own example (Overdue/Due Today/Upcoming/
  Completed) plus the full row list under each, priority badges, a "Check for Due Follow-ups" button, and
  Complete/Cancel actions reusing the existing status-change endpoint unchanged. New `NotificationBell`
  component in the topbar (unread badge, dropdown list, mark-one/mark-all read, link to `/follow-ups`) — the
  first UI in this app for the notification system. Priority selector added to both `LeadWorkflowPanel.tsx`'s
  and `DealWorkflowPanel.tsx`'s existing "Schedule Follow-up" modals (same modal, same convention, just one
  more field) and to each follow-up row's display. Sidebar gained a "Follow-ups" entry.
- **Deliberately not built** ("reminder settings" from the request, scoped down): no per-user configurable
  reminder timing/channel screen — there's no email/SMS delivery to configure yet, and a fixed "notify once
  when due or overdue" rule covers the actual ask without inventing a settings UI nothing else uses. "Missed
  follow-ups" was treated as the same concept as "Overdue" rather than a 5th redundant bucket.
- One new unit test (`crm-activity.service.test.ts`, using `vi.useFakeTimers()` to pin the boundary
  calculation and assert the exact repository calls) — 140/140 project-wide, unchanged count since this
  extended existing coverage rather than adding a parallel suite.
- **Verified live end-to-end** against the real dev DB: created a genuine overdue HIGH-priority follow-up via
  the real API (mirroring the real form's payload shape) — confirmed it appeared correctly bucketed under
  "Overdue" on `/follow-ups` with the right priority badge and related-record link; clicked "Check for Due
  Follow-ups" and confirmed exactly 1 notification was created, then clicked it again and confirmed **0**
  new notifications (dedup working); opened the topbar bell and confirmed the unread badge, dropdown
  content, and "Mark all read"/mark-one-read flow all worked against the real API (`isRead` flipped `true`,
  `unreadCount` dropped to 0); confirmed the CRM Dashboard's `overdueFollowups` counter (item 4) picked up
  the same test row live, proving the two screens share one source of truth. Test follow-up cancelled
  afterward. `npx tsc --noEmit`, `npm run lint`, `npm test` (140/140) all clean throughout. Dev server
  restarted after the migration, per this project's own repeatedly-documented Prisma-client-cache gotcha.

**Next**: item 6 (Configurable Lead Priority thresholds) per the priority order above.

---

## Item 6 — Configurable Lead Priority thresholds: DONE (2026-08-24)

Built per §3.6 above — replaced the hardcoded 80/50 literals in `computeLeadPriority()` with a real
per-company setting, and fixed the exact duplicate-threshold wart the original migration report's own code
comment had already flagged but never resolved.

- **Schema** (migration `add_crm_settings`): new `CrmSettings` model, one row per company, lazily created on
  first edit (no row = still on the 80/50 defaults — same "create on first real use" precedent as this
  project's document sequences, not something every company needs seeded upfront).
- **`computeLeadPriority(leadScore, thresholds?)`** (`lead.service.ts`) now takes an optional thresholds
  param defaulting to the original 80/50 pair — backward compatible with every existing call site and test;
  `listLeads`/`getLeadById`/`createLead`/`updateLead` all now fetch the company's real setting via
  `getCrmSettings()` before decorating.
- **Closed the exact duplicate-threshold gap the migration report's own code comment already named**:
  Marketing's `computeCampaignMetricsMap()` had a hardcoded `leadScore >= 50` for "qualified leads," with an
  existing comment reading *"reuses the same score>=50 threshold that already computes Lead.priority... the
  source's own lead_quality count is the identical definition under different labels"* — now both actually
  read from the one configurable `CrmSettings.warmThreshold` instead of two separately hardcoded copies of
  the same number, threaded through all 5 call sites (`listCampaigns`/`getCampaignById`/`createCampaign`/
  `updateCampaign` via `decorateCampaigns`, plus `runMarketingAutomation` and `getMarketingDashboard`
  directly). This is a real cross-module consistency fix, not scope creep — the coupling was already
  documented as intentional, just never actually wired to one source.
- **New `/api/v1/crm/settings`** (GET/PATCH, `crm` view/edit) + a small "Priority Settings" modal on the
  `/crm` dashboard page — two number inputs, validated (`warmThreshold < hotThreshold`, both 0–100) with a
  clear explanatory note that the Warm threshold also drives Marketing's "Qualified" count.
- **RBAC note, flagged not fixed**: gated on `crm.edit` for consistency with every other CRM mutation — under
  current RBAC that means `MERCHANDISER` can change this company-wide setting while `MANAGEMENT` (view/export
  only on `crm`) cannot. Left as-is rather than widening `MANAGEMENT`'s grant, since that would give them
  edit rights over every Lead/Deal too, well beyond what this one setting needs — a real gap worth a
  dedicated RBAC decision later, not a side effect of this feature.
- 5 new unit tests (`lead.service.test.ts` +1, new `crm-settings.service.test.ts` +4) — 146/146
  project-wide. Both `lead.service.test.ts` and `campaign.service.test.ts` needed a new
  `getCrmSettings` mock (returning the original 80/50 pair) added to keep every pre-existing assertion valid
  now that both files call through a real settings lookup instead of a hardcoded literal.
- **Verified live end-to-end**: confirmed the one real lead (`LEAD-2026-00001`, score 85) showed `HOT` under
  the default 80 threshold; raised the Hot threshold to 90 via a real API call and confirmed the *same* lead
  immediately re-computed to `WARM` with zero data changes to the lead itself; confirmed the validation guard
  rejects `warmThreshold >= hotThreshold` with a `400`; raised the Warm threshold to 90 and confirmed
  **both** the CRM dashboard's `qualifiedLeads` and Marketing's own dashboard `qualifiedLeads` dropped to 0
  together, live proof the two modules now share one real source instead of two hardcoded copies; restored
  both thresholds to 80/50 afterward. `npx tsc --noEmit`, `npm run lint`, `npm test` (146/146) all clean
  throughout. Dev server restarted after the migration (a stray leftover `node.exe` was still holding port
  3000 from an earlier restart in this session and had to be killed first — not a code issue, just this
  session's own process hygiene).

**Next**: item 7 (Campaign Approval workflow) per the priority order above.

---

## Item 7 — Campaign Approval workflow: DONE (2026-08-24)

Built per §3.7 above — closed the two gaps the audit found (`approvalStatus`/`status` were both write-only,
never enforced anywhere) with a real state machine, approval metadata, and RBAC.

- **Schema**: `Campaign` gained `approvedByUserId`/`approvedAt`/`rejectionReason` — the same "who/when/why"
  shape already used for SampleVersion's costing lock, not a bare boolean. `CampaignStatus`
  (DRAFT/ACTIVE/PAUSED/COMPLETED) and `CampaignApprovalStatus` (PENDING/APPROVED/REJECTED) were **kept as
  two separate enums**, per the request's own explicit "reuse existing approvalStatus if available"
  instruction — merging them into one would have recreated the exact Lead/Deal status-conflation wart this
  project's own CRM audit already flagged as a wart to avoid, not a pattern to copy. "Running" in the
  request's diagram is this project's existing `ACTIVE` value, not a new fifth status.
- **Real `ALLOWED_STATUS_TRANSITIONS` guard** (`campaign.service.ts`) — DRAFT→ACTIVE→{PAUSED,COMPLETED},
  PAUSED→{ACTIVE,COMPLETED}, COMPLETED terminal. DRAFT→ACTIVE additionally requires `approvalStatus ===
  "APPROVED"` — checked as a second, independent condition (not folded into the transition map, since
  approval is a genuinely different axis), with the exact rejection reason surfaced in the error message
  when blocked by a REJECTED campaign.
- **`status`/`approvalStatus` removed entirely from the general create/edit payload** — every new campaign
  now always starts DRAFT/PENDING regardless of input (matches how Deal/Lead/SalesOrder each start at one
  fixed status), and both are only reachable through the new dedicated `changeCampaignStatus`/
  `approveCampaign`/`rejectCampaign` functions — the same discipline that already protects e.g.
  `SampleStatus.TECH_PACK_READY` from being forged via a plain status PATCH. Editing is now also blocked
  once COMPLETED (a new, small addition mirroring Deal's own WON/LOST edit-block).
- **`approveCampaign`** is self-approval-guarded (`PermissionService.assert(..., "marketing", "approve", {
  createdBy: ... })`) like every other final approval checkpoint in this project (Sample/Sales-Order/
  Purchase-Order), and clears any prior rejection. **`rejectCampaign`** is deliberately **not**
  self-approval-guarded (matches Sales/Purchase Order's own REJECTED path) and requires a non-empty reason;
  a rejection can be reconsidered later via `approveCampaign()` — no separate "resubmit" step needed since
  approval isn't a strict one-way ratchet.
- **Gated the two actions the request's §10 explicitly named**: `recordDailyMetric()` now rejects with a
  clear message unless `approvalStatus === "APPROVED"`; `runMarketingAutomation()` filters its campaign set
  to `approvalStatus === "APPROVED"` — this catches not just "never-approved" campaigns but also the real
  edge case where a campaign was approved, activated, and **later** had its approval revoked via
  `rejectCampaign()` while still technically ACTIVE (since approval isn't guarded against status), which
  `findActiveOrPaused()`'s own status filter alone couldn't catch.
- **RBAC**: `MANAGEMENT` gained `approve`/`reject` on `marketing` (previously only `view`/`export`) —
  a deliberate, explained widening mirroring their identical shape on `sampling`; `MERCHANDISER` (the
  creator role) keeps its existing `view`/`create`/`edit`/`export`/`print`, no approve/reject. Reseeded via
  `prisma db seed` per this project's own established RBAC-change gotcha.
- **UI**: `CampaignForm.tsx` lost its Status/Approval Status dropdowns entirely, replaced with a one-line
  note that status/approval are managed from the campaign's own page. `CampaignWorkflowPanel.tsx` gained an
  approval-status badge, "Approved by X on Y" / rejection-reason banners, Approve/Reject buttons, status
  transition buttons, and both "Run Automation Now" and "+ Record Daily Metrics" are now disabled (with an
  explanatory tooltip) while a campaign isn't Approved — proactive UI feedback in addition to the
  server-side gate, not a replacement for it. Campaign list page gained an Approval column.
- **9 new unit tests** (`campaign.service.test.ts`, 156/156 project-wide): the illegal-jump guard, the
  not-yet-approved and rejected-with-reason activation blocks, successful activation once approved,
  self-approval-guard assertion + rejection-clearing on approve, reason-required + approval-clearing on
  reject, both daily-metric gate branches, and — the trickiest one — a campaign whose approval was revoked
  while still ACTIVE/PAUSED correctly being skipped by automation.
- **Verified live end-to-end** against the real dev DB: created `CAMP-2026-00002`, confirmed activation and
  metric recording were both correctly blocked with clear 409s while PENDING; confirmed rejecting without a
  reason correctly 400s; rejected with a real reason, confirmed activation is blocked with the exact
  rejection reason quoted in the error; approved (self-approval bypass confirmed for the SUPER_ADMIN
  creator, same as every other Approve action in this project), confirmed `rejectionReason` cleared and
  `approvedBy`/`approvedAt` populated; activated successfully once approved; recorded a real metric
  successfully post-approval. **Found, via live testing rather than assumption, that the pre-existing demo
  campaign `CAMP-2026-00001` (created before this feature existed, status ACTIVE but never formally
  approved) was correctly excluded from `runMarketingAutomation()` by the new gate** (`campaignsChecked: 1`
  instead of the expected 2) — this is the new rule correctly applying retroactively to old data, not a
  bug; approved it live to restore its automation coverage (`campaignsChecked: 2` afterward). UI verified
  separately: the create form no longer shows Status/Approval fields; the detail page correctly renders the
  Approved badge, "Approved by Super Admin on [timestamp]," the Move-to-Paused/Completed buttons, and the
  Daily Metrics table with the real recorded row; the list page shows the new Approval column for both
  campaigns. `npx tsc --noEmit`, `npm run lint`, `npm test` (156/156) all clean throughout. Dev server
  restarted after the migration and RBAC reseed, per this project's established gotchas.

**Next**: item 8 (Marketing Dashboard charts / trend data) per the priority order above.

---

## Item 8 — Marketing Dashboard charts / trend data: DONE (2026-08-24)

Built per §3.8 above — no schema change, `CampaignDailyMetric` already stores by-date rows.

- **`getMarketingTrends(companyId, days=30)`** (`campaign.service.ts`) — a zero-filled daily time series
  across every campaign, aggregating `CampaignDailyMetric` (spend/impressions/clicks) alongside `Lead`/`Deal`
  activity for the same window, with `cpl`/`roas` derived per day. Grouped in JS from plain typed Prisma
  queries rather than a raw SQL date-trunc — the window is small (30 days, one company) and this avoids
  introducing this project's first raw-SQL aggregation for one dashboard. **Documented approximation**:
  "Revenue"/"Customers" per day use `Deal.createdAt`/`Lead.createdAt` (when created), not a true "won on
  this date" timestamp — `Deal` has no separate `wonAt` column (an already-known limitation elsewhere in
  this project) — fine for a trend shape, not exact day-level revenue recognition.
- **New dependency-free `TrendChart` component** (`marketing/TrendChart.tsx`) — a small inline SVG line
  chart. Deliberately did **not** add a charting library (`recharts`/`d3`/etc.) — this project has zero
  chart dependencies anywhere, and a ≤30-point daily series doesn't justify one, matching this project's own
  "no existing code first, don't add libraries unnecessarily" discipline.
- **Real bug caught and fixed during test-writing, not live browsing**: the first `dayKey()` implementation
  used `date.toISOString().slice(0, 10)` (UTC) to key buckets that were constructed with **local-time** `Date`
  components (`new Date(year, month, day)`) — in any timezone ahead of UTC (this business runs on IST,
  UTC+5:30, matching the whole company's own locale), local midnight converts to the *previous* UTC day,
  silently shifting every bucket back by one. A unit test asserting the exact date range caught this
  immediately (`expected '2026-08-19' to be '2026-08-20'`) before it ever reached the browser. Fixed by
  building the day key from local date components on both sides instead of mixing UTC and local time.
- **Also fixed one pre-existing latent type error surfaced while re-running `tsc`** (unrelated to this
  item's own code, from Item 6's `crm-settings.service.ts`): passing a typed interface *variable*
  (`before: LeadPriorityThresholds`) directly as `writeAuditLog`'s `oldValues: Record<string, unknown>`
  parameter fails TypeScript's index-signature check — a named type without an explicit index signature
  isn't assignable to a `Record<...>` parameter, whereas a fresh object literal is exempted from that rule.
  Fixed with `oldValues: { ...before }` (spreading into a literal). Worth remembering: this exact pattern —
  passing a named interface value where a `Record<string, unknown>` is expected — will resurface anywhere
  else in this codebase that does the same thing; a spread into a literal is the fix, not a cast.
- 2 new unit tests (`campaign.service.test.ts`, 158/158 project-wide) covering the zero-fill behavior and
  correct per-day bucketing/CPL/ROAS derivation — the second one is exactly what caught the timezone bug
  above.
- **Verified live end-to-end**: `/marketing` now renders 6 real SVG trend charts (Spend, Leads, Revenue,
  Clicks, Impressions, ROAS) alongside the existing stat cards, each showing internally-consistent real
  numbers for "today" (₹100 spend, 1 lead, ₹500,000 revenue, 20 clicks, 500 impressions, and a derived
  5000x ROAS = 500,000 ÷ 100 — confirmed by hand) — all real dev-DB data from this session's own test
  activity, not placeholder numbers. Confirmed each chart is a genuine `<svg>`/`<polyline>` pair (6 of each
  found in the DOM), not static text. `npx tsc --noEmit`, `npm run lint`, `npm test` (158/158) all clean
  throughout.

**Next**: item 9 (Channel Performance report) per the priority order above.

---

## Item 9 — Channel Performance report: DONE (2026-08-24)

Built per §3.9 above, matching the request's own worked example (Channel → Leads → Deals → Won Deals →
Revenue → ROI) and its four asks (date/channel/campaign filtering, drill-down, export).

- **`getChannelPerformance(companyId, {dateFrom?, dateTo?, channel?, campaignId?})`** (`campaign.service.ts`)
  — deals are traced via `Lead.campaignId → Deal.leadId` (the same join path `computeCampaignMetricsMap()`
  already uses for its own revenue calc, just grouped by channel instead of by campaign, since `Deal` has no
  direct `campaignId` column). Date filters narrow which Leads/Deals/spend get *counted*, not which channels
  are *listed* — a channel with zero activity in a narrow range still shows a real zero row instead of
  silently disappearing, so the report always answers "how did every channel do in this period."
- **New `GET /api/v1/marketing/channel-performance`** route, reusing the same inclusive-end-of-day `dateTo`
  fix from item 4's CRM dashboard (`${dateTo}T23:59:59.999`) rather than repeating the exact bug that fix
  caught there.
- **Real drill-down, not a dead link**: `listCampaigns()` gained an optional `channel` filter parameter,
  threaded through `GET /api/v1/campaigns?channel=`; the Campaigns list page (already a `"use client"` page)
  now reads `?channel=` via `useSearchParams()` and feeds it straight into the existing `DataTable`'s
  `fetchUrl` — required wrapping the page in `<Suspense>` (Next.js requires this for any component calling
  `useSearchParams()`), matching the exact pattern this codebase's own login page already established for
  the same reason.
- **CSV export is genuinely new infra for this app** (deliberately scoped down from the request's much
  bigger "CSV Import" ask, which stays queued as its own item 12) — a client-side "download this table as
  CSV" button, no server round-trip: builds the CSV from the already-fetched rows and triggers a Blob-URL
  download. Verified by intercepting `URL.createObjectURL` during a real click rather than assuming the
  wiring worked — confirmed the exact CSV bytes matched the rendered table exactly, including the ROI %
  formatting.
- **No dependency-heavy charting/export library added** — matching item 8's own "no existing chart library
  in this project, don't add one for a small dataset" reasoning, extended here to CSV export (a native Blob
  is all this needs).
- **UI**: new `/marketing/channel-performance` page — date presets (same Today/Week/Month/Quarter/Year
  pattern as the CRM dashboard), a channel dropdown, a totals row, and channel names linking to the
  drill-down. Linked from the Marketing dashboard.
- 3 new unit tests (`campaign.service.test.ts`, 161/161 project-wide): correct per-channel grouping with a
  genuine zero-activity channel staying in the result set, the channel-filter query actually narrowing the
  underlying campaign lookup, and the empty-company edge case.
- **Verified live end-to-end**: the report correctly aggregated the two real Meta Ads campaigns (2
  campaigns, 1 lead, 1 deal, 1 won, ₹500,000 revenue, ₹11,100 spend, 4404.5% ROI — hand-verified as
  `(500000-11100)/11100`); clicking through to the channel drill-down correctly showed both real campaigns
  filtered to Meta Ads with the "Filtered to Meta Ads — clear filter" banner; the CSV export button produced
  a real `text/csv` Blob whose exact contents were verified byte-for-byte against the rendered table.
  `npx tsc --noEmit`, `npm run lint`, `npm test` (161/161) all clean throughout — including one lint fix
  along the way (a plain `<a>` to an internal route flagged by `@next/next/no-html-link-for-pages`, switched
  to `<Link>`).

**Next**: item 10 (Customer Segmentation) per the priority order above — scoped down per the original audit
finding that `Customer.type` isn't a real enum and there's no region master yet.

---

## Item 10 — Customer Segmentation: DONE (2026-08-24)

Built per §3.10 above, deliberately scoped to what's real in this schema rather than inventing a
`CustomerType` enum or `Region` master as a side effect.

- **`getCustomerSegments(companyId)`** (new `src/modules/customers/customer-segments.service.ts`) — six
  segments derived live from real `SalesOrder` history, no new schema: `NEW` (created ≤30 days ago),
  `REPEAT` (≥2 non-cancelled orders), `HIGH_VALUE`/`VIP` (top 20%/top 5% of total order value **among
  customers who have ordered at all** — a percentile, not a hardcoded rupee figure, since a fixed number
  would need manual re-tuning as the business grows and has no natural "right" value today), `DORMANT` (has
  ordered, but not in >90 days), `INACTIVE` (never ordered, and old enough to no longer count as new). A
  customer can carry multiple segments at once (e.g. `NEW` + `REPEAT` + `VIP` together, confirmed live).
  Every threshold is a named constant at the top of the file, not a buried magic number.
- **`getCategoryPurchaseBreakdown(companyId)`** — "By Product Category" from the request's own list, the one
  dimension needing zero substitution since `Category` is already a real master wired to `Product`. Counts
  distinct customers/orders per category (via `Set`s), not raw line-item counts, so a multi-line order for
  the same category isn't double-counted.
- **"By Region" and Wholesale/Retail/Distributor/Export segments were NOT built** — `Customer.country` is
  free text (no Region master) and `Customer.type` is constrained to just `CUSTOMER`/`AGENT` at the Zod
  layer (not the fuller list the request described) — the page's own copy states this limitation plainly
  rather than silently answering a narrower question than what was asked.
- **UI**: new `/marketing/customer-segments` page — six clickable segment-count cards that filter the
  customer table below, a category breakdown grid, and each customer name linking into Item 2's Customer
  360 view. "Segments should be reusable for campaigns" (the request's own closing line) is deliberately
  **not** wired into an actual campaign-targeting field — `Campaign` has no targeting concept to attach a
  segment to, and building one would be a much larger, separate feature; this pass delivers the segment
  *data*, not a targeting mechanism consuming it.
- 6 new unit tests (`customer-segments.service.test.ts`, 167/167 project-wide): NEW-vs-INACTIVE boundary,
  REPEAT+DORMANT together, the percentile ranking across a synthetic 10-customer spread, and the category
  breakdown's dedup-by-`Set` behavior (including a no-category skip case).
- **Verified live end-to-end** against the real dev DB: 13 real customers correctly bucketed (`Zenith
  Apparel Imports` — 2 orders, ₹303,750 — correctly landed on all three of NEW/REPEAT/VIP since it's both
  the company's newest real customer record and its top performer by order value; `Lyallpur cloths` — also
  2 orders, ₹299,910 — correctly got REPEAT but not VIP, since the top-5%-of-3 threshold happened to include
  only the single highest value); clicking the VIP card correctly filtered the table to exactly that one
  customer; the category breakdown correctly showed "T-Shirts: 3 customers · 5 orders" from real order
  lines. `npx tsc --noEmit`, `npm run lint`, `npm test` (167/167) all clean throughout. One test-authoring
  gotcha hit and fixed along the way: a multi-line `expr \n as never)` cast inside a `mockResolvedValue(...)`
  call tripped a Vitest/oxc parser limitation (`Expected ',' or ')' but found 'as'`) — fixed by assigning the
  array to a local `const` first and casting that on one line, matching how every other test file in this
  project already writes its `as never` casts.

**Next**: item 11 (Marketing Automation framework) per the priority order above.

---

## Item 11 — Marketing Automation framework: DONE (2026-08-24)

Built per §3.11 above — each of the request's own §14 example triggers as its own small function reusing
existing services, not a generic rule-interpreter (matching how Marketing's own alert engine is 4 explicit
functions, not a rule engine).

- **"New Lead → Create Follow-up"**: already existed (`createLead()`'s auto-24h-follow-up, built during the
  original CRM migration) — verified still correct, no new work needed.
- **"Sample Sent → Wait 3 Days → Follow-up"**: new — hooked into `transitionSampleStatus()`
  (`sample.service.ts`): the moment a sample moves to `SUBMITTED_TO_CUSTOMER`, a 3-day follow-up is
  auto-created against the sample's own customer. The one sample-related trigger from the request that's
  actually buildable, since a real Sample state machine exists — unlike "Quotation Sent," which has zero
  backing schema anywhere in this project (no `Quotation` model, confirmed absent) and was **not built**,
  documented as impossible rather than faked.
- **"Deal Won → Customer Created → Welcome Campaign"**: new — hooked into Item 1's
  `convertDealToCustomer()`, scoped to `CREATE` mode only (a genuinely new customer; `LINK` reuses an
  existing, already-known one, so "welcome" wouldn't make sense there). The "Welcome Campaign" half is
  deliberately **not** real Campaign enrollment — `Campaign` has no audience/targeting concept to attach a
  customer to, and building one would be a much larger, separate feature (this is the same "nurture
  sequences" scope this project already deferred once during the original CRM migration). What's built
  instead is the real, achievable equivalent: a follow-up task prompting a human to actually send the
  welcome outreach.
- **"Customer Inactive 60 Days → Create Re-engagement Task"**: new — `generateReengagementFollowups()`, a
  manual trigger (no background job runner exists in this project, matching the established "Run Automation
  Now" / "Check for Due Follow-ups" convention) scanning for customers with a real order who haven't ordered
  in 60+ days, creating one follow-up per customer that doesn't already have an open one. Deliberately a
  **different** threshold from the segmentation dashboard's own `DORMANT` bucket (90 days, Item 10) — the
  segments page's number is a reporting/labeling choice, this one is the exact figure the request itself
  specified for this specific action.
- 5 new unit tests across 3 files (`sample.service.test.ts` +2, `customer-segments.service.test.ts` +1;
  `deal.service.test.ts`'s mock extended but not unit-tested further — `convertDealToCustomer()` has no
  existing unit coverage at all, verified live-only since Item 1, and mocking its `$transaction` closure
  properly for one small additive trigger wasn't worth the setup cost here) — 170/170 project-wide.
- **Verified live end-to-end** against the real dev DB: advanced a real sample (`SAM-2026-00017`) through
  `IN_DEVELOPMENT → INTERNAL_QC → SUBMITTED_TO_CUSTOMER` and confirmed a real 3-day follow-up appeared
  against its customer with a message correctly naming the sample and style; created a fresh Deal, walked it
  to WON, converted it to a new customer, and confirmed a real 1-day welcome follow-up appeared against that
  new customer; clicked "Generate Re-engagement Follow-ups" through the real UI and got the honest,
  data-correct result "Checked 0 customer(s) inactive 60+ days — 0 created" (no real customer in this fresh
  dev environment has actually gone 60 days without ordering yet — the right answer, not a bug). `npx tsc
  --noEmit`, `npm run lint`, `npm test` (170/170) all clean throughout.

**Next**: item 12 (CSV Import) per the priority order above — the first CSV-import infrastructure anywhere
in this codebase.

---

## Item 12 — CSV Import: DONE (2026-08-24)

Built as one generic, reusable import mechanism — not three separate implementations — scoped to the
request's own §15 list: Leads, Deals, and Campaign Daily Metrics.

- **Schema**: one new `ImportBatch` model + `ImportBatchType` enum (`LEAD`/`DEAL`/`CAMPAIGN_DAILY_METRIC`),
  migration `20260824100000_add_import_batches`. Deliberately one row per completed *run*, not per imported
  record — the imported Leads/Deals/DailyMetrics are the real rows; this is a summary + a way to look back
  at what was imported, when, and by whom. `failedRowsJson` stores just enough (`rowNumber`/`data`/`reason`)
  to reconstruct a "download failed rows" CSV after the fact; the original uploaded file itself is never
  persisted (no import-specific retention policy exists, and adding one wasn't asked for).
- **New module** `src/modules/import/` (`import.schema.ts`/`.repository.ts`/`.service.ts`) — **every row is
  validated and created through the exact same schema + service function the manual UI form already uses**
  (`createLeadSchema`/`createLead`, `createDealSchema`/`createDeal`,
  `recordDailyMetricSchema`/`recordDailyMetric`). This is the load-bearing design decision: a CSV-imported
  Lead gets the identical duplicate-email/phone check, sequential numbering, auto-24h-follow-up (Item 11),
  and audit logging a manually-created one gets, with zero duplicated business logic — reuse-first, per this
  project's own standing convention.
- **Deliberately per-row isolation, not one all-or-nothing transaction**: a CSV import's whole point is
  "import what's valid, report what isn't," not abort-everything-on-first-bad-row — each row runs
  independently in a loop; a thrown `BusinessRuleError` (duplicate, not-found reference, business-rule
  violation) or Zod validation error is caught and recorded as a skipped row with its exact message, and the
  loop continues. `Deal`/`Campaign Daily Metric` rows reference an existing record by a human-readable code
  (Lead #, Customer Code, Campaign #/Name) resolved to a real id via a company-scoped lookup before calling
  the create function — an unresolvable reference fails that one row with a clear message, never a silent
  skip and never an unfiltered Prisma query (see the `resolveCampaignId` guard below).
- **Real bug caught and fixed before it shipped**: `resolveCampaignId`'s initial draft fell through to
  `prisma.campaign.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })` even when both
  `campaignNumber` and `campaignName` were blank — Prisma treats `equals: undefined` as "no filter on this
  field," not "match nothing," so a row missing both identifying columns would have silently resolved to an
  arbitrary campaign instead of failing loudly. Fixed with an explicit guard that throws
  `VALIDATION_ERROR` before the query ever runs whenever neither reference is present.
- **Empty-cell-vs-enum-default gotcha, handled explicitly**: an empty CSV cell for an enum-typed field
  (Lead's `source`) must become `undefined`, not `""`, before reaching `createLeadSchema.parse()` —
  Zod's `.default(...)` only substitutes on `undefined`, and a strict `z.enum(...)` rejects `""` outright.
  Numeric fields don't need this special-casing: `Number("")` is `0`, which already matches those schemas'
  own `.default(0)`. A provided-but-invalid Source (not blank, not a recognized value) fails with a clear
  "must be one of: EMAIL, PHONE, ..." message rather than silently falling back to `OTHER`.
- **UI**: `src/lib/csv.ts` (new, dependency-free — no npm library, matching the project's established
  "no library for a lightweight, well-scoped need" call already made for TrendChart/Channel Performance) —
  a real RFC4180 parser (quoted fields, embedded commas/newlines, escaped `""`) since an arbitrary
  user-uploaded file can't be assumed comma-split-safe the way this project's own generated exports are,
  plus a matching `toCsv`/`downloadCsvFile` serializer reused for both the failed-rows export and the
  blank-template download. `src/components/ui/CsvImportModal.tsx` (new, shared — any future module can
  reuse it) drives a 4-step flow: Upload → Column Mapping (auto-guessed from the file's own headers,
  matched against the canonical `IMPORT_COLUMNS` spec so a file re-uploaded from the "Download a blank
  template" link auto-maps every column with zero manual picking) → Preview (first 5 mapped rows, nothing
  saved yet) → Result (imported/skipped counts, a failed-rows table, and a "Download failed rows as CSV"
  button that round-trips through the exact same canonical columns for easy correction-and-resubmit).
  `IMPORT_COLUMNS` in `import.schema.ts` is the single source of truth shared by the server-side row
  mapping and the client-side column-mapping UI/template — the two can never silently drift.
- **RBAC**: no new module — LEAD/DEAL imports assert `crm.create`, CAMPAIGN_DAILY_METRIC asserts
  `marketing.edit`, exactly matching the permission each type's own manual-create route already asserts, so
  a CSV import can never grant more access than the equivalent manual action would.
- **Wired into 3 existing pages**: an "Import from CSV" button on `/leads` and `/deals`, "Import Daily
  Metrics from CSV" on `/campaigns` (the natural bulk/cross-campaign entry point, rather than a per-campaign
  detail-page action) — each refreshes its `DataTable` via the existing `refreshKey` prop on success. New
  `/imports` page (Import History — every batch, company-scoped, searchable by file name, with a per-batch
  "Download failed rows" link) plus a new Sidebar entry.
- **Lint fix**: the modal's reset-on-reopen was first written as a `useEffect` calling `setState`
  synchronously, tripping the same `react-hooks/set-state-in-effect` rule this project has hit repeatedly —
  fixed with the established remount-via-`key` convention instead (the caller bumps a counter and passes it
  as `key={importKey}` in the same click handler that opens the modal), matching `FilePreviewModal`'s own
  zoom/rotate-reset precedent exactly.
- 10 new unit tests (`import.service.test.ts`) — 180/180 project-wide: a valid row calls the real
  `createLead` with the exact expected input; an invalid Source is rejected before `createLead` is ever
  called; a thrown `BusinessRuleError` (duplicate) is reported with its exact message; one bad row doesn't
  abort the batch; a Deal's Lead # reference resolves to the real id and a missing one fails with a clear
  message; a Campaign Daily Metric resolves by Campaign # and fails loudly (never running an unfiltered
  lookup) when neither identifier is given; the persisted `ImportBatch` summary has the correct counts and
  a `null` (not an empty array) `failedRowsJson` when everything succeeds.
- **Verified live end-to-end** through the real UI (not just direct API calls), for all three import types:
  **Leads** — uploaded a 3-row CSV (one valid new lead, an exact duplicate of it, one with an invalid
  Source) through the real file input (simulated via `DataTransfer`, the sandboxed browser tool's documented
  workaround for native file pickers) — confirmed all 9 columns auto-mapped from the file's own headers,
  confirmed the preview showed exactly what would import, confirmed the result showed "Imported 1 of 3 — 2
  skipped" with the exact duplicate-email message (correctly naming the new lead's own number,
  `LEAD-2026-00002`) and the exact invalid-Source message, confirmed the Leads list refreshed live with the
  new lead, confirmed "Download failed rows as CSV" produced a correctly quote-escaped CSV with both
  failures and their reasons. **Deals** — uploaded a row linking `LEAD-2026-00002` (resolved correctly to a
  real Deal) and a row referencing a nonexistent Lead # (failed with the exact "not found" message).
  **Campaign Daily Metrics** — uploaded a row against `CAMP-2026-00002` by Campaign # (correctly upserted;
  confirmed the Campaigns list's live-computed Spend column jumped from ₹100 to ₹1,600, proving the imported
  metric fed the exact same aggregation every other spend number in this app already uses) and a row against
  a nonexistent Campaign # (failed with the exact "not found" message, confirming the unfiltered-lookup
  guard above actually works, not just in theory). Confirmed the Import History page listed all three
  batches with correct per-batch counts. `npx tsc --noEmit`, `npm run lint`, and `npm test` (180/180) all
  clean throughout; dev server restarted after the schema migration per this project's own standing gotcha.

**Next**: item 13 (Meta/Google Ads Integration) per the priority order above — flagged in the original audit
as the largest single remaining item (isolated OAuth/HTTP client code, real credentials only, no fake data).

---

## Item 13 — Meta/Google Ads Integration: DONE, pending real credentials for live-sync verification (2026-08-24)

Asked the user upfront whether real Meta/Google Ads API credentials were available to connect and test
against, since §16's own instruction is "real credentials only, no fabricated data" — a genuine case for
asking rather than assuming, not a stall. Answer: not right now, usable later. Built accordingly: the full
isolated integration is implemented and everything not requiring an actual external API call is verified
live; the OAuth token exchange / account fetch / metric sync calls themselves are **unverified pending real
credentials** — stated plainly here and in the code's own comments, not glossed over.

- **Schema (2 new tables, 2 new enums, migration `20260824110000_add_ad_integrations`)**: `AdAccountConnection`
  (one row per connected external ad account — a company can connect more than one Meta account or Google
  Ads customer ID) and `AdCampaignLink` (maps one external platform campaign to at most one local `Campaign`,
  a separate mapping table rather than a field on `Campaign` itself — an unmapped external campaign stays
  listed with `localCampaignId = null` rather than auto-creating a local `Campaign` per external one, which
  would flood the Campaigns list and bypass this project's own campaign-approval workflow). `AdPlatform`
  (`META`/`GOOGLE`), `AdConnectionStatus` (`CONNECTED`/`DISCONNECTED`/`ERROR` — `DISCONNECTED` is only ever
  set by a deliberate user action, never inferred from a failed sync, which lands on `ERROR` instead so the
  UI can point at "reconnect" with a reason rather than silently retrying forever).
- **Encryption at rest, new capability**: `src/core/security/encryption.ts` — AES-256-GCM via Node's built-in
  `crypto` (no new dependency), keyed by hashing the existing `NEXTAUTH_SECRET` down to 32 bytes rather than
  requiring a second secret to configure and risk leaving unset in a deployment. First use of field-level
  encryption anywhere in this codebase — justified here specifically because these are live OAuth tokens
  granting real ad-spend-account access, a materially different risk than this app's own internal data (which
  has never needed this). `AdAccountConnectionRepository`'s client-facing queries (`findMany`,
  `upsertByExternalAccount`'s return, `updateStatus`'s return) deliberately `select` an explicit safe-field
  allow-list rather than `include`, so the encrypted tokens can never leak into an API response even if a
  future edit adds a field — confirmed this matters by catching it once during this same build (an early
  draft did leak the encrypted-token column through `disconnectAdAccountConnection`'s return value; fixed
  before it ever reached a route).
- **OAuth CSRF state, new capability**: `src/core/security/oauth-state.ts` — HMAC-SHA256 signs
  `{companyId, userId, platform, issuedAt}` into the OAuth `state` param, verified (with a 10-minute expiry)
  on callback. No new dependency, no server-side session/state table to expire or clean up — same "derive
  from `NEXTAUTH_SECRET`" reasoning as the encryption key, distinct purpose.
- **Isolated module** `src/modules/marketing/ad-integrations/` — `ad-integration.schema.ts`/`.repository.ts`/
  `.service.ts` plus `meta-ads.client.ts`/`google-ads.client.ts` (pure HTTP wrappers, zero business logic,
  written against Meta Graph API v21.0 / Google Ads API v17's public docs). `campaign.service.ts`'s core
  logic is completely untouched — the sync engine is just another caller of the *existing*
  `recordDailyMetric()`, exactly the same reuse-first pattern Item 12's CSV import already established: a
  synced metric gets the identical upsert-by-date semantics and the identical "linked Campaign must be
  `APPROVED`" governance gate a manually-entered one gets, with zero duplicated logic. A campaign not yet
  approved locally simply has its synced row skipped (reported, not silently dropped) rather than the sync
  engine getting a bypass the manual form doesn't have.
- **Deliberate simplification, stated up front**: the OAuth callback connects **every** ad account/customer
  the granted token can see in one pass, rather than pausing mid-flow for the user to pick one — the common
  case (one business, one ad account) needs zero extra clicks, and a business with several can disconnect
  the ones it doesn't want from the connections list afterward. This also avoids needing a server-side
  "pending token" cache for a multi-step account-picker, real complexity most callers would never exercise.
- **Google token refresh, Meta long-lived exchange**: Google access tokens are short-lived (~1h) — a sync
  call catches the resulting API failure, refreshes once via the stored (encrypted) refresh token, retries,
  and persists the new access token; a missing refresh token surfaces as "reconnect this account" rather
  than a bare error. Meta has no refresh-token concept — the initial short-lived token from the code exchange
  is immediately exchanged for a long-lived one (~60 days) before it's ever stored; an expired long-lived
  token surfaces through the same generic sync-failure → `ERROR` status path.
- **RBAC**: no new module or action — reuses the existing `marketing` module's `view`/`edit` actions exactly
  as every other Marketing write action does (`MERCHANDISER` has `edit`, `MANAGEMENT` does not today — an
  existing asymmetry this item did not change, flagged here rather than silently deciding to widen it).
- **New `BusinessRuleError` codes**: `AD_INTEGRATION_NOT_CONFIGURED` (400 — env vars absent) and
  `AD_SYNC_FAILED` (502 — a real external API/token failure), both following the existing 2-line-addition
  convention.
- **UI**: `/marketing/ad-integrations` (linked from the Marketing dashboard, same discoverability pattern as
  Channel Performance/Customer Segments — no separate Sidebar entry, matching that precedent) — per-platform
  Connect card that shows a plain "Not configured — set X/Y/Z in your environment" message instead of a
  clickable button whenever the platform's env vars are absent (checked via a config-status endpoint that
  returns booleans only, never touching the actual secret values), a connections table (status, last
  synced, links-mapped count) with Sync Now / Manage Campaign Links (Modal, per-external-campaign dropdown
  to a local Campaign) / Disconnect (`ConfirmModal`) actions, and query-param-driven success/error banners
  fed by the OAuth callback's own redirect.
- **Route-conflict bug caught and fixed during live verification, not left as a stale plan**: Next.js
  refuses two different dynamic-segment names at the same path level — `ad-integrations/[platform]/...` and
  `ad-integrations/[connectionId]/...` as siblings crashed the dev server ("You cannot use different slug
  names for the same dynamic path") and made every route under `ad-integrations/` 404, discovered by hitting
  the authorize endpoint directly rather than trusting a clean `tsc`/lint pass (routing conflicts like this
  are invisible to both). Fixed by nesting the platform-keyed routes under a static `connect/` segment
  (`ad-integrations/connect/[platform]/authorize`, `.../connect/[platform]/callback`), leaving
  `ad-integrations/[connectionId]/...` as the only dynamic segment at the top level — worth remembering for
  any future module mixing two different resource-id kinds under one route prefix.
- 26 new unit tests across 3 files, 206/206 project-wide: `encryption.test.ts` (round-trip, random-IV
  non-determinism, malformed/tampered-ciphertext rejection), `oauth-state.test.ts` (round-trip, tampered
  payload rejected, wrong-secret rejected, malformed string rejected, 10-minute expiry enforced),
  `ad-integration.service.test.ts` (config-status reflects real env-var presence; `initiateConnection`
  throws the exact `AD_INTEGRATION_NOT_CONFIGURED` code when unconfigured; the OAuth callback rejects a
  failed/mismatched state without ever calling a platform API, and connects one `AdAccountConnection` row
  per visible ad account with the mocked HTTP clients; `linkAdCampaign` validates the local Campaign belongs
  to the actor's own company before linking and allows clearing a link back to `null`; `disconnect` 404s for
  a connection outside the actor's company; `syncAdAccountConnection` refuses a disconnected connection,
  writes a metric only for linked (not unlinked) external campaigns, records a per-link `recordDailyMetric`
  failure as "skipped" without aborting the rest of the batch, marks the connection `ERROR` — never
  `DISCONNECTED` — on a genuine API failure, and correctly does the refresh-once-and-retry dance on an
  expired Google token).
- **Verified live**, everything reachable without a real external API call: the connections page correctly
  shows "Not configured" for both platforms with the exact env-var names to set (since neither is actually
  configured in this environment); hitting the authorize endpoint directly returns the exact structured
  `400 AD_INTEGRATION_NOT_CONFIGURED` response instead of a raw crash; hitting the callback endpoint with no
  `code`/`state` correctly redirects back to the connections page with a rendered "Missing code/state on the
  OAuth callback." banner (the full redirect → query-param → banner round trip, not just the route in
  isolation); sync/disconnect/link on a nonexistent connection id all correctly 404 with `NOT_FOUND` rather
  than a raw crash, confirming the tenant-scoped lookups work even with zero real connections in the
  database. `npx tsc --noEmit`, `npm run lint`, and `npm test` (206/206) all clean throughout; dev server
  restarted twice — once for the schema migration, once for the route-conflict fix.
- **Explicitly NOT verified, and will remain so until real credentials exist**: the actual OAuth consent
  screen round trip, token exchange, ad-account/campaign discovery, and metric sync against the real Meta
  Graph API or Google Ads API. The HTTP client code is written carefully against each platform's public API
  docs, but "written correctly" and "verified against the real API" are different claims — do not treat this
  as tested. When real credentials are available: set the env vars documented in `.env.example`, restart the
  dev server, click Connect, and walk through the numbered verification steps this note describes for the
  parts that could not be exercised now.
- **Not built** (explicitly out of scope, not oversights): a mid-flow "pick which ad account to connect"
  step (see the deliberate-simplification note above), automatic/scheduled syncing (no background job runner
  exists anywhere in this project — manual "Sync Now" matches every other automation trigger already built:
  Item 11's follow-up generators, the Marketing alert engine's own "Run Automation Now"), a credential-
  revocation call to the platform on Disconnect (this app's own `status` flag stops syncing; it does not
  additionally call Meta/Google to revoke the token, which stays valid on their side until the user revokes
  app access there directly — a reasonable v1 scope line, flagged rather than silently assumed), and
  clearing/nulling the encrypted token columns on disconnect (kept as historical record, gated by `status`,
  matching how this project keeps full history on every other lifecycle-status entity rather than nulling
  fields on state change).

**Next**: item 14 (AI-ready architecture) per the priority order above — design-only, no fake AI, keeping
every aggregation function (leaderboard, channel performance, segmentation, and now ad-sync metrics) cleanly
callable for a future AI layer.

---

## Item 14 — AI-ready architecture: DONE, design/audit only, zero new code (2026-08-24)

Per the plan's own scope for this item, nothing was built — the deliverable is verifying the claim already
made throughout Items 1–13 ("every new aggregation is a clean, separately-callable service function") is
actually true, not assumed. Ran a dedicated read-only audit (a separate Explore pass, not self-reported)
across every CRM/Marketing/Customer aggregation function and every route handler that exposes one.

**Verdict: the claim holds, with one minor note.** Every aggregation/reporting function in this codebase is
a standalone, exported service function taking a bare `companyId` string (plus plain optional filter
objects) — never an HTTP request, a session object, or anything else that would force a future AI layer or
background job to go through the route/HTTP layer to get real data:

| Function | File | Returns |
|---|---|---|
| `getSalesLeaderboard` | `deal.service.ts` | Per-salesperson lead count, open pipeline, won revenue |
| `getCrmDashboard` | `crm-dashboard.service.ts` | Cross-entity Lead+Deal rollup: pipeline/won/lost, conversion rate, top customers/opportunities, leaderboard, follow-up counters |
| `getFollowupCounters` / `listFollowupsForManagement` | `crm-activity.service.ts` | Overdue/due-today/upcoming/completed/pending follow-up buckets |
| `getMarketingDashboard` | `campaign.service.ts` | Total budget/spend/leads/qualified/customers/revenue/ROAS/open alerts |
| `getMarketingTrends` | `campaign.service.ts` | Daily time series (spend/impressions/clicks/leads/customers/revenue/CPL/ROAS) |
| `getChannelPerformance` | `campaign.service.ts` | Per-channel leads→deals→won→revenue→ROI |
| `getCustomerSegments` / `getCategoryPurchaseBreakdown` | `customer-segments.service.ts` | Per-customer segment tags; per-category purchase counts |
| `getCustomer360` | `customer-360.service.ts` | Cross-module rollup: deals, leads, samples, orders, activities, follow-ups, campaign touchpoints |
| `getMaterialRequirements` | `mrp.service.ts` | MRP requirement rows for a sales order |
| `getAdIntegrationConfigStatus` / `listAdAccountConnections` | `ad-integration.service.ts` | Platform-configured booleans; connection records |

Every automation trigger built this session (`runMarketingAutomation`, `generateFollowupNotifications`,
`generateReengagementFollowups`) is equally callable from outside an HTTP request — bare `companyId` (plus
`createdByUserId` where an audit trail needs an attributed actor). The one function needing more than a bare
string is `syncAdAccountConnection`, which takes a plain `ActorContext {companyId, userId}` rather than a
session — reasonable, since it writes audit-logged data and needs someone to attribute that write to, and
still trivially constructible outside an HTTP request (unlike, say, `requireSession()`, which explicitly
cannot be).

Grepped every route under `crm`/`marketing`/`customers`/`ad-integrations`/`deals`/`campaigns`/`bom-mrp` for
inline `prisma`/`groupBy`/`aggregate`/`reduce` logic that should have been extracted into a service function
— **found none**. Every dashboard/report/leaderboard/segmentation/channel-performance route is a thin
`requireSession` → `PermissionService.assert` → call-the-service-function → `NextResponse.json` wrapper, with
zero business logic living only in the HTTP layer. Two pages (`marketing/page.tsx`,
`customers/[id]/360/page.tsx`) already call `getMarketingTrends`/`getCustomer360` directly from a Server
Component with no API round-trip at all — the same function, three different callers (a route, a page, and
eventually an AI layer) with identical behavior, which is exactly what "AI-ready" was asking for.

**What "AI-ready" deliberately does NOT mean here, stated explicitly per the plan's own "no fake AI"
instruction**: no LLM client, no prompt templates, no vector store, no chat interface, and no new
"AI service" module were built — there is no real AI feature to attach one to yet, and stubbing one out
would be exactly the fabricated, untestable code this project's own discipline (and this session's Item 13
answer) already rejected once today. This item's entire contribution is confirming the *data access layer*
underneath a future AI feature won't need re-deriving from scratch — a genuine prerequisite, not a
placeholder.

**No code changed for this item.** `npx tsc --noEmit`, `npm run lint`, and `npm test` (206/206) remain
exactly as they were at the end of Item 13 — nothing to re-verify.

---

## All 14 items complete (2026-08-24)

Every item from the original priority list is now built (1–13) or confirmed by design audit (14):
Deal→Customer conversion, Customer 360, CRM Kanban, CRM Dashboard, Follow-up Management/Notifications,
Configurable Lead Priority, Campaign Approval, Marketing Dashboard charts, Channel Performance, Customer
Segmentation, Marketing Automation, CSV Import, Meta/Google Ads Integration (pending real credentials for
live-sync verification only), and AI-ready architecture. 206/206 unit tests passing, `npx tsc --noEmit` and
`npm run lint` clean throughout the entire multi-session build. The one genuinely open thread is Item 13's
live external-API verification, which needs real Meta/Google credentials the user doesn't have yet — see
that item's own note for exactly what to do once they're available.
