# Sales & Marketing — Phase 07 Sales channels, commissions and incentives (2026-11-03)

Spec: `ref/07.md`. Plan: `RELEASE_PLAN.md` (R2.4, R2.5, widened). Scope confirmed 2026-11-03:

- **Core.** Channels: flat master, set on enquiry → quotation → Sales Order (the order is authoritative; changes on the order are logged) and a channel report. Commission plans with versions and approval: % of the basis (one rate, or all-units / progressive tiers) or a fixed amount per invoice, minimum basis and cap per month. Single-owner credit. Monthly statements: calculate → submit → approve → pay; reversals as negative lines. Incentives: target-attainment bonus tiers on Phase 05 targets.
- **Earners**: internal reps (Phase 05 sales credit on the order) **and** external Sales Agents (existing master) through a new optional *Sales agent* on enquiry / quotation / order.
- **Basis**: each plan chooses **invoiced value** (earned when the Sales Invoice is posted, reversed if it is cancelled) or **collected value** (earned as customer payments are allocated to the invoice, pro rata, reversed if the payment is cancelled). Always before GST.
- **Settlement**: approving a statement raises a **Payment Request** (new type *Sales commission*) in the existing Accounts hub; Accounts approves and pays it there (Dr Sales Commission expense / Cr bank); the statement shows Paid from the request's own status.

**Not in this phase:** split credit, channel hierarchy, team / territory / channel-manager payees, stacking several plans for one payee, margin-based commission (no reliable cost per order line), clawback of incentives after later cancellations, partial returns (sales invoices have no credit notes in this ERP), payroll integration, partner portal.

## 1. What existed (reused, not rebuilt)

Sales Agents master (`sales_agents`, with a free `commissionPercent` nobody used), Phase 05 sales credit on orders (`salesRepUserId`), approved targets and `metricTotals()`, Sales Invoices (posted / cancelled), Payments + allocations (posted / cancelled), Payment Requests hub with approval matrix and per-type payout handlers, `PermissionService` incl. the self-approval guard, audit log, notifications, Report Center. No channel, commission plan, statement or incentive existed.

## 2. Channels

`sales_channels`: code, name, description, active, optional manager (user). Deactivate, never delete.

Each of **enquiry**, **quotation** and **Sales Order** has its own `salesChannelId` and `salesAgentId` — three separate facts (where the enquiry came from, what the quotation was made under, what the sale is credited to), not one field. Defaults flow forward: a quotation made from an enquiry copies its channel and agent; a Sales Order converted from a quotation copies the quotation's. They are set or changed from each record's page (*Channel & agent → Change*); on a Sales Order the change needs `sales_performance.edit` and a reason and is logged like the sales credit (history kept; reports always use the order's current values). The **channel credited for a sale = the Sales Order's channel**; channel reports read it through the same `metricTotals()` as Phase 05 (new grouping CHANNEL), so channel figures never disagree with rep / territory figures.

## 3. Commission plans

`sales_commission_plans` (code, name, **payee type** Rep or Sales agent, **basis** Invoiced or Collected, active) + numbered **versions** (`sales_commission_plan_versions`): Draft → Pending approval → Approved (approver ≠ whoever prepared / submitted it), Withdrawn (an approved version that hasn't started yet). Only a Draft is edited; a change to an approved plan is a new version. Each version has effective from / to and its rule:

| Field | Meaning |
|---|---|
| method | **Percent** of the basis, or **Fixed** amount per posted invoice (invoiced basis only) |
| tiers (percent) | list of *from basis ₹ → rate %*; first tier starts at 0; boundaries strictly increasing; one tier = a flat rate |
| tier mode | **All-units**: the tier reached by the month's basis sets the rate for the whole basis. **Progressive**: each slice of the basis is paid at its own tier's rate |
| minimum basis | no commission for the month below this basis (threshold) |
| cap | maximum commission per payee per month |

Examples (tiers 0 → 2 %, 1,00,000 → 3 %; month basis ₹1,50,000): all-units = 1,50,000 × 3 % = ₹4,500; progressive = 1,00,000 × 2 % + 50,000 × 3 % = ₹3,500. Boundary inclusive: exactly ₹1,00,000 is in the 3 % tier.

The version in force on an **event's date** (§4) values that event; a month with events under two versions is computed per version and added up (each with its own tiers, minimum and cap).

**Assignments** (`sales_commission_assignments`): plan + payee (a user for Rep plans, a Sales Agent for agent plans) + from / to dates. A payee has at most one assignment in force on any day (no stacking — overlaps are refused). Assignments are effective-dated, so a payee who moves plan keeps their history.

## 4. Earning events, calculation and reversals (`commission-engine.ts`, pure)

**Events** (each has a stable key, so no event is ever paid twice):

| Basis | Event | Date | Amount (basis) | Key |
|---|---|---|---|---|
| Invoiced | Sales Invoice posted (Posted / Partially paid / Paid / Closed) | invoice date | subtotal × exchange rate (before GST) | `INV:<invoice>` |
| Collected | a posted customer payment allocated to an invoice | payment date | allocated × invoice subtotal ÷ invoice total (the GST share is removed) | `ALLOC:<allocation>` |

**Payee** of an event = the invoice's Sales Order **rep** (Phase 05 credit) for Rep plans, or its **Sales agent** for agent plans, read when the statement is calculated. An event earns only if the payee has an assignment whose plan has that basis, in force on the event date, and an approved version in force on that date.

**Calculation order** for a payee and month M (statement): 1) collect events dated up to the end of M that no submitted / approved statement has already taken (late events are picked up next month — catch-up, never twice); 2) group by plan version; 3) per version: basis B = Σ events; if B < minimum → 0; else apply tiers (all-units or progressive) or fixed × invoices; cap; round half-up to the paisa once; 4) spread the version's commission over its events in proportion to their basis (remainder on the largest line) so each line shows its share and effective rate; 5) add **reversals**, **carry-forward** and **manual adjustments** (not tiered or capped); 6) net = Σ lines.

**Reversals.** When an event already in a submitted / approved statement disappears — its invoice is cancelled, or its payment is cancelled — the next calculation adds a negative line referencing the original line, for exactly the original line's amount (never more), key `REV:<line>`. Lines in a draft are simply recalculated.

**Negative month.** If a month's net is below zero it is approved as "to recover": no payment request; the next statement for that payee starts with a **carry-forward** line of that amount.

**Adjustments.** While a statement is a Draft, `sales_commissions.create` can add a manual line (± amount, reason); it survives recalculation.

## 5. Incentives (target-attainment bonus)

`sales_incentive_plans`: code, name, metric (any Phase 05 metric), period type (month / quarter / year), effective from / to, **tiers** of *attainment % → fixed reward ₹* (highest tier reached wins, not cumulative), optional list of reps (empty = every rep with an approved target), status Draft → Pending approval → Approved → Retired (approver ≠ preparer; approved plans are never edited — retire and make a new one).

Evaluated when a statement is calculated for the month in which a target period **ends**: for each approved plan in force on the period end, each eligible rep with an **approved Phase 05 REP target** for that metric and period: attainment = actual (`metricTotals`, Phase 05 rules) ÷ target. The reward goes on that month's statement as an *Incentive* line, key `INC:<plan>:<period start>`, so it is never awarded twice. Rewards use actuals only, never the forecast. Rewards aren't clawed back if orders are cancelled after the period ends (limitation).

## 6. Statements and settlement

`sales_commission_statements`: one per payee per month. **Draft** (calculated, can be recalculated, adjusted, discarded) → **Pending approval** (submitted; lines frozen) → **Approved** (approver ≠ preparer / submitter; `sales_commissions.approve`). Sent back = Draft with a reason. On approval with net > 0 the system raises a **Payment Request** (type *Sales commission*, pay-to = rep or agent name, amount = net, source = the statement, idempotent); if that fails the statement shows *Raise payment request* to retry. The statement's **payment** status is read from the request (Waiting for approval / Approved / Partly paid / Paid / Rejected / Cancelled); a rejected or cancelled request can be raised again. Calculated, approved, requested and paid are shown separately and never mixed.

## 7. Permissions — new module `sales_commissions`

view = own statements (reps); view_all = everyone's statements and agent statements; create = calculate statements, add adjustments; edit = plans, versions, assignments, incentive plans; approve / reject = plan versions, incentive plans, statements; export. Grants: Management all (incl. approve); Merchandiser view + export; Viewer view; Super Admin all. Channels are managed with `sales_marketing_settings.edit`. Paying is the Accounts payment-request flow (`payment_requests.*`).

## 8. Screens and reports

- **Sales & Marketing → Channels** (settings area): list, create, edit, deactivate; this month's booked value per channel.
- *Channel & agent* panel on the enquiry, quotation and Sales Order pages.
- **Commissions**: plans (list, detail with versions, rule editor, approval, assignments); incentive plans; statements (calculate a month, list, detail with lines, adjustments, submit / approve / send back, payment status).
- **Reports**: *Sales by Channel* (booked value, orders, accepted quotations, invoiced per channel) and *Commission Register* (statement lines).

## 9. Code map

| Area | Files |
|---|---|
| Schema | `prisma/migrations/20261104090000_sales_commissions_phase7/` (rollback: `prisma/rollback/20261104090000_sales_commissions_phase7.down.sql`) — `sales_channels`, `sales_commission_plans` / `_plan_versions` / `_assignments` / `_statements` / `_lines`, `sales_incentive_plans`; `sales_channel_id` + `sales_agent_id` on `buyer_enquiries`, `quotations`, `sales_orders`; `PaymentRequestType.SALES_COMMISSION`; permissions `sales_commissions.*` |
| Pure maths | `src/modules/sales-marketing/commissions/commission-engine.ts` (tiers, minimum, cap, spread in paise, incentive tier, collected basis) |
| Services | `channels/sales-channel.service.ts`, `commissions/commission-plan.service.ts`, `commissions/incentive-plan.service.ts`, `commissions/commission-statement.service.ts`; defaults: `quotation.service.ts` (enquiry → quotation), `performance/sales-credit.service.ts#resolveDefaultChannel` (quotation → order); `performance-actuals.ts` grouping `CHANNEL` |
| Settlement | `accounts/payment-requests/request-type-registry.ts` (`SALES_COMMISSION`, raised only from a statement), `payout.service.ts#paySalesCommission` (Dr *Sales Commission* SALES-COMM expense / Cr bank-cash) |
| APIs | `/api/v1/sales-marketing/channels` (+ `[id]`, `[id]/status`, `options`); `/enquiries/[id]/channel`, `/quotations/[id]/channel`, `/performance/orders/[id]/channel`; `/commissions/plans` (+ `[id]`, `status`, `versions`, `versions/[versionId]`, `versions/[versionId]/[action]`, `assignments`, `assignments/[assignmentId]`); `/commissions/incentives` (+ `[id]`, `[id]/[action]`); `/commissions/statements` (+ `calculate`, `[id]`, `[id]/adjustments`, `[id]/adjustments/[lineId]`, `[id]/[action]`) |
| Screens | `/sales-marketing/channels`, `/sales-marketing/commissions` (statements), `/commissions/statements/[id]`, `/commissions/plans` (+ `new`, `[id]`), `/commissions/incentives` (+ `new`, `[id]`); *Channel & sales agent* panel on enquiry, quotation and Sales Order pages (`components/sales-marketing/channels/ChannelAgentPanel.tsx`) |
| Reports | `src/modules/reports/sales-commissions.reports.ts` — *Sales by Channel*, *Commission Register* |
| Tests | `commission-engine.test.ts` (9), `commissions.integration.test.ts` (7, real DB), `api/v1/sales-marketing/commissions/routes.test.ts` (3), `components/sales-marketing/commissions/commission-screens.test.tsx` (5) |

## 10. Rules settled while building

- **A plan version can't start inside a closed month.** Approving a version is refused when any submitted / approved statement with commission from that plan ends on or after the version's start. (Found by the integration test: the first draft checked event dates only, so a late invoice dated inside an approved month could have been valued by the newer rule.)
- **Spread rounding**: the version's commission is split over its lines in paise by weight; the leftover paisa goes to the largest line (e.g. ₹3,500 over ₹1,00,000 + ₹50,000 → ₹2,333.34 + ₹1,166.66). A reversal is exactly the original line's amount.
- **Earnings are paid once per payee type**: an invoice already in a statement for any rep isn't earned again by another rep after a credit change (likewise for agents).
- **Statements are submitted only after the month ends**; a current-month calculation is a preview. Incentives for a target period are added only once the period is over.
- **Payment request idempotency key** `commission-statement:<id>:<attempt>` — re-raising after a rejected / cancelled request makes a new one; the statement links the latest.
- **Self-approval**: approver ≠ whoever calculated or submitted; a rep can't approve their own statement (Super Admin excepted, as everywhere).

## 11. Limitations (known, not built)

- Catch-up items (dated in a month whose statement was already submitted) are valued with the month they are picked up in, so their tier is set by that month's basis, not the original month's.
- Payee is read when the statement is calculated: changing an order's rep / agent after a draft but before submit moves draft commission with it; after submit it stays with whoever earned it.
- No split credit, stacking, team / channel-manager payees, margin-based commission, partial returns (no sales credit notes in this ERP), incentive clawback, payroll / TDS handling — commission is paid as a plain expense payment request.
- Cap and minimum apply per plan version per month; a month split across two versions gets each version's cap.
- The statement approver can't also pay the request (payment-request guard: never the raiser).

## 12. Verification (sandbox, 2026-11-04)

- `tsc --noEmit` clean; ESLint 0 errors (22 warnings, all pre-existing); `next build` compiles all routes (its built-in type-check step was OOM-killed by the sandbox's memory limit on two attempts, so the build was finished with that step skipped and the config restored; the separate `tsc --noEmit` run is clean).
- Full suite (real DB): 4,119 passed, 3 failed — the two known flaky CRM workflow / bulk-action integration tests (untouched code) and the company-scoping contract test, which flagged `updateIncentivePlan`; fixed (its guarded update now scopes by company) and re-run green (140/140).
- Integration test (`commissions.integration.test.ts`, real Postgres): progressive ₹1,50,000 → ₹3,500 spread ₹2,333.34 + ₹1,166.66; agent 5 % of ₹50,000 collected (₹52,500 incl. GST) = ₹2,500; incentive 150 % → ₹2,500; adjustment survives recalculation; self-approval refused; approval raised a SALES_COMMISSION payment request for ₹6,100; cancelled invoice → reversal −₹1,166.66; late invoice caught up once (₹200); negative month approved with no request and carried forward (−₹966.66) into the next preview; reports agree. It also caught the plan-version freeze bug described in §10.
- Live (browser, dev DB): created channel *Export buyers*; set it on ORD-2026-00001 with a reason (history shown); posted a real Sales Invoice INV-2026-00001 (₹2,760) through the existing invoice flow; created plan REP-STD (all-units 2 % / 3 % from ₹2,000; worked example ₹82.80), approved, assigned Super Admin; calculated October → one statement, ₹82.80 at 3 % on that invoice; added ₹50 adjustment, submitted, approved → PRQ-2026-00001 (Sales Commission, ₹132.80, waiting for approval). Sales by Channel (October): Export buyers booked ₹2,760, invoiced ₹2,760; accepted quotations ₹1,76,520 under *No channel* (quotations made before channels existed). Commission Register lists both lines. No console errors.
- Rollback rehearsal on a copy of the dev DB: down script removes all 7 tables and the 6 document columns; migration re-applies cleanly (the enum value `SALES_COMMISSION` stays, as noted in the script).
