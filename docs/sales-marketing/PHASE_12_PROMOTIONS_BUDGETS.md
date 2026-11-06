# Sales & Marketing — Phase 12 Promotions, offers and campaign budgets (2026-11-06)

Spec: `docs/sales-marketing/ref/12.md`. Scope confirmed with the user on 2026-11-06:

- **Applying:** per promotion, either **automatic** (every eligible quotation line) or **with a code** entered on the quotation.
- **Benefits:** **line discounts only** — % off or ₹ off per base unit — through the existing Phase 03 pricing engine. No buy-X-get-Y, free goods, order-level or tiered offers.
- **Spend sources:** **Expenses + Purchase Orders + Purchase Invoices.** An optional campaign (and budget line) is set on POs and Purchase Invoices, as Expenses already had since Phase 08. Committed = approved POs not yet invoiced; actual = approved Expenses + posted Purchase Invoices.
- **Budget split:** **allocation lines** by spend category (a configurable list), optionally per campaign delivery channel. The Phase 08 approved planned budget stays the overall limit.

Out of scope (later phases): attribution and ROI (13), bulk tools (14), AI (18).

## 1. What existed (reused, not rebuilt)

| Need | Reused |
|---|---|
| Price arithmetic, stacking, cap, rounding | Phase 03 `pricing-engine.ts` — promotions are extra engine inputs ("rules"). There is no second engine. |
| Where a price came from | The quotation line's `pricing` snapshot (Phase 03), now also naming the promotion version. |
| Issue / accept / reject / revise / cancel | Phase S3 quotation lifecycle (`quotation-lifecycle.service.ts`); hooks only. |
| Quotation → Sales Order | S4 conversion (`markConverted`); hook only. |
| Sales Order cancel | `transitionSalesOrderStatus`; hook only. |
| Campaigns, approved plan budget, revisions | Phase 08. The approved `plannedBudget` is the budget limit. |
| Campaign spend link | Phase 08 `expenses.campaign_id`; Phase 12 adds the same column to POs and Purchase Invoices. |
| Spend categories | Phase 08 campaign lookups (new kind `SPEND_CATEGORY`). |
| Customer eligibility by segment | Phase 09 snapshots (`marketing_segment_snapshot_entries`). |
| History | `pricing_events` (entity `PROMOTION`), `sales_performance_events` (entity `CAMPAIGN`), `audit_logs`. |
| Background jobs | The shared BullMQ worker (`npm run worker`). |

## 2. Data model (migration `20261107090000_marketing_promotions_budgets_phase12`, rollback in `prisma/rollback/`)

- `marketing_promotions`: header.
  - Fields: code (unique per company, `^[A-Z0-9][A-Z0-9_-]{2,29}$`), name, owner, `apply_mode` AUTO | CODE, `status` DRAFT | ACTIVE | PAUSED | ARCHIVED, `approved_version_id`.
  - CHECK: anything but DRAFT / ARCHIVED needs an approved version.
- `marketing_promotion_versions`: the terms.
  - Discount type and value; stacking; priority; validity dates.
  - Style / category / excluded-Style / price-list lists.
  - Customer list, sales channels, campaigns, segment snapshot.
  - Minimum quantity (base units) and minimum line value.
  - Total and per-customer use limits; change note.
  - Lifecycle: DRAFT → PENDING_APPROVAL → APPROVED | REJECTED; APPROVED → SUPERSEDED when a newer version is approved.
  - Partial unique index: one open (draft / pending) version per promotion.
  - CHECKs: value > 0 and ≤ 100 for %; dates in order; positive limits; the decider is neither the creator nor the submitter.
  - Trigger `marketing_promotion_versions_frozen`: a decided version can't change, except APPROVED → SUPERSEDED with every other column identical.
- `marketing_promotion_redemptions`: one row per (promotion, quotation revision) — unique.
  - Status RESERVED → REDEEMED → RELEASED, or RESERVED → RELEASED.
  - Fields: discount given (₹, before GST), `expires_on`, Sales Order, release reason.
  - Trigger `marketing_promotion_redemptions_forward`: a status never moves backwards.
- `marketing_budget_allocations`: campaign budget lines — name (unique per campaign, case-insensitive), spend category, optional campaign channel, amount, ACTIVE | CLOSED, version.
- `marketing_budget_alerts`: raised alerts.
  - Partial unique index: one OPEN alert per (campaign, scope, kind).
  - Scope = an allocation id, or `-` for the whole campaign.
- New columns:
  - `expenses.budget_allocation_id`;
  - `purchase_orders.campaign_id` and `budget_allocation_id`;
  - `purchase_invoices.campaign_id` and `budget_allocation_id`;
  - each with a CHECK that a budget line implies a campaign.
- Also new:
  - `quotation_revisions.promotion_codes`;
  - `sales_marketing_settings.budget_warn_percent` (50–99, default 80);
  - lookup kind `SPEND_CATEGORY`.
- Permission module `marketing_promotions`:

  | Role | Actions |
  |---|---|
  | SUPER_ADMIN | all |
  | MANAGEMENT | view, create, edit, delete, approve, reject, export |
  | MERCHANDISER | view, create, edit |
  | VIEWER | view |

  Budgets use the existing `marketing_campaigns` permissions. Linking a finance record also needs view on that record's module (`expenses`, `purchase_order`, `invoices`).

## 3. Promotion rules

### 3.1 Lifecycle

- A promotion prices nothing until a version is **approved** *and* the promotion is **switched on**.
- Approving and switching on are separate steps; switching on needs `approve`.
- The approver can't be the person who created, last saved or submitted the version (Super Admin excepted, as everywhere).
- To change approved terms, start a new version (a copy of the latest). It replaces the approved one only when it is itself approved. Issued quotations keep their prices.
- **Pause / archive** stop new prices only. Issued quotations keep their prices, and their reservations run their course.
- **Display status** is derived; there is no scheduler:
  - On and before the start date → *Scheduled*.
  - On and after the end date → *Expired*.
  - Otherwise → *Running*.
  - Dates are compared with the **quotation date**.

### 3.2 Eligibility

Checked in this order, with the reason shown:

1. **Context** (`promotion-eligibility.ts`), per quotation:
   - switched on with an approved version;
   - AUTO, or CODE with its code entered;
   - valid on the quotation date;
   - sales channel and campaign of the quotation;
   - customer list;
   - in the segment snapshot (`outcome = INCLUDED`) — prospects never qualify for customer or segment promotions;
   - usage limits.
2. **Line** (the engine), per line:
   - Styles; categories (both must match when both are set); excluded Styles;
   - price list used;
   - minimum quantity in the Style's base unit;
   - minimum line value (list price × quantity).

Entered codes that don't exist, aren't usable, or don't apply are reported. A quotation **can't be saved** with an unusable code.

### 3.3 Calculation precedence

This is Phase 03 unchanged. Promotions and discount rules compete together:

1. List price P from the price list.
2. **Exclusive** discounts: the single largest wins. Ties go to the higher priority, then the code.
3. **Stackable** discounts chain on the running price, in priority order.
4. The line takes the larger of (best exclusive) and (stackable chain).
5. Optional company cap on the total discount %. When capped, each applied discount's recorded per-unit amount is scaled by cap ÷ uncapped, so they still add up.
6. The net price is rounded half-up to the paisa **once**.

A manually overridden price carries no promotion.

### 3.4 Usage (redemption)

| Event | Effect |
|---|---|
| Preview / draft save | Nothing — read-only |
| Issue a revision | RESERVED per promotion on its lines; counts until the revision's valid-until |
| Customer accepts | Still RESERVED, no longer expires |
| Converted to a Sales Order | REDEEMED (+ order id) |
| Rejected, cancelled, revised (superseded) | RELEASED |
| Valid-until passed | Stops counting that day; the nightly job marks it RELEASED |
| Sales Order cancelled | REDEEMED → RELEASED (the use is given back) |

- **Limits** count REDEEMED + RESERVED not past `expires_on`.
- **Concurrency:** at issue, each promotion row is locked `FOR UPDATE`, in id order (no deadlocks). The limit is then re-counted inside the transaction. Concurrent issues therefore can't exceed a limit; the loser's issue fails with a clear message, and the quotation stays a draft.
- **Duplicates:** the unique (promotion, revision) key plus an idempotent upsert mean a retry never counts twice.
- **Stale terms:** if the promotion was paused, archived or re-versioned after the draft was priced, issuing refuses ("changed since the prices were worked out"). `revalidateDraft` also refuses when re-pricing the draft gives a different price.

## 4. Budget formulas

All amounts are in company currency (INR), **before GST**, and are computed live from the finance records linked to the campaign (`budgets/budget-math.ts`). Nothing is copied out of Finance, so there is no sync table and nothing to double-count.

| Measure | Definition |
|---|---|
| Approved | The campaign's planned budget once a plan revision is approved (`approved_revision_number` set); otherwise none |
| Allocated | Σ budget-line amounts (active and closed) |
| Actual | Σ linked Expenses in APPROVED / PARTIALLY_PAID / PAID (`amount`) + Σ Purchase Invoices in POSTED / PARTIALLY_PAID / PAID / CLOSED (`subtotal × exchange_rate`) |
| Committed | Σ over linked POs in APPROVED / SENT_TO_SUPPLIER / PARTIALLY_RECEIVED / FULLY_RECEIVED / ON_HOLD of max(0, PO base total − posted invoices against that PO) |
| Pending (pipeline) | Expenses PENDING_APPROVAL + POs in DRAFT + Purchase Invoices in DRAFT — shown, **not counted** |
| Remaining | Approved − Actual − Committed |
| Used % | (Actual + Committed) ÷ Approved × 100 |

Per budget line, the same formulas apply with the line's amount as the limit. Spend linked without a line shows as **Not allocated**, against the approved budget not yet in a line.

**No double counting:**

- A Purchase Invoice without its own campaign counts for its **PO's** campaign and budget line.
- Posting it moves money from Committed to Actual; the total doesn't change.
- An invoice can't be linked to a campaign other than its PO's.
- A PO can't be linked while one of its invoices names another campaign.
- Each record holds one campaign, guarded on update.
- Rejected and cancelled records never count.
- Unlinking clears the budget line too.

**Corrections and reversals** need no sync. A cancelled PO, a cancelled invoice or a rejected expense simply drops out of the next calculation. Because the alert job re-evaluates every 30 minutes, alerts follow.

**Phase 08 figures:** the campaign page's budget summary and the Campaign Register report now use these same measures, so Actual includes posted invoices and Committed is shown. With only expenses linked, the numbers are unchanged.

### 4.1 Budget lines

- Only on a campaign with an approved budget.
- The lines' sum can't exceed the approved budget. This is checked under a campaign row lock.
- A line's amount can't go below what is spent or committed on it.
- **Move budget** shifts an amount between two lines; the total is unchanged and a reason is required.
- A **closed** line takes no new spend, but its spend still counts.
- Only an unused line can be removed.
- Changing lines needs no approval, because lines can never exceed the approved total. Changing the total itself is a Phase 08 plan change, which is approved.

### 4.2 Alerts

Each kind has a scope and a condition:

| Kind | Scope | When |
|---|---|---|
| WARN_THRESHOLD | Campaign or line | Used % ≥ the company setting (default 80) and not over |
| OVER_BUDGET | Campaign or line | Actual + Committed > limit (replaces the warning) |
| OVER_ALLOCATED | Campaign | Lines add up to more than the approved budget (e.g. after a plan change lowered it) |
| ENDED_WITH_OPEN_COMMITMENTS | Campaign | Completed or past its planned end, with committed > 0 |

How alerts behave:

- A new condition raises **one** OPEN row and notifies the campaign owner **once**.
- An unchanged condition raises nothing. The partial unique index makes even concurrent evaluations harmless.
- When the condition goes away, the alert is CLEARED.
- Evaluation runs right after any budget-line or link change, and every 30 minutes in the worker (`budget.alerts`), because Finance changes record statuses outside this module.

## 5. Screens

- **Sales & Marketing → Promotions**:
  - list with derived status, approved terms, reserved / used counts;
  - **New promotion** (header + version 1 terms).
- **Promotion detail**:
  - switch on / pause / archive;
  - versions with terms, edit draft, submit / approve / reject / return to draft, new version;
  - uses (quotation → Sales Order, discount, status, expiry);
  - history.
- **Quotation editor**: a *Promotion codes* field. The live price preview applies automatic and entered promotions and lists unusable codes.
- **Quotation detail**: the codes, and per line "promotion CODE vN" next to the price-list source.
- **Campaign → Budget** panel:
  - approved, in lines, actual, committed, pending and remaining figures, with a used bar;
  - budget lines (add, edit, close / reopen, remove, move budget);
  - linked expenses, POs and invoices, each with a budget-line selector and Unlink;
  - **Link spend** (search unlinked records of each kind);
  - alert history.
  - Finance documents are listed only to users who can view that module; their amounts are in the totals either way.
- **Campaign → Promotions for this campaign**: read-only, for users with `marketing_promotions.view`.
- **Sales & Marketing → Campaign Budgets**: overview of the campaigns the viewer can see, with totals, used bar, open alerts, and filters (status, search, with open alerts only).
- **Settings**: "Warn when a campaign budget is this % used". **Campaign settings**: the "Budget spend categories" list.

## 6. Code map

- Promotions:
  - `src/modules/sales-marketing/promotions/` — `promotion-registry.ts` (client-safe), `promotion-eligibility.ts`, `promotion.service.ts`, `redemption.service.ts`, `promotion-jobs.worker.ts`;
  - tests `promotions-budgets.integration.test.ts`.
- Budgets:
  - `src/modules/sales-marketing/budgets/` — `budget-math.ts` (pure formulas + alert conditions), `budget.service.ts`;
  - tests `budget-math.test.ts`.
- Engine:
  - `pricing/pricing-engine.ts` — promotion fields, cap scaling;
  - `pricing.service.ts` — `priceLinesDetailed`;
  - test `pricing-engine.promotions.test.ts`.
- Hooks:
  - `quotations/quotation-lifecycle.service.ts` — issue / accept / reject / revise / cancel;
  - `quotation-conversion.service.ts` — redeem;
  - `sales-orders/sales-order.service.ts` — release on cancel.
- APIs:
  - `/api/v1/sales-marketing/promotions` (list, create, `options`), `/promotions/[id]` (get, patch), `/promotions/[id]/[activate|pause|archive]`;
  - `/promotions/[id]/versions` (new), `/versions/[versionId]` (save), `/versions/[versionId]/[submit|return-to-draft|approve|reject]`;
  - `/campaigns/[id]/budget`, `/budget/allocations`, `/budget/allocations/[allocationId]`, `/budget/transfer`, `/budget/spend` (search, link), `/budget/spend/unlink`;
  - `/campaigns/[id]/promotions`, `/budgets`;
  - `/pricing/calculate` now also returns `promotions` beside `data`.
- UI:
  - `src/components/sales-marketing/promotions/*`, `src/components/sales-marketing/budgets/*`;
  - pages under `src/app/(dashboard)/sales-marketing/promotions` and `/budgets`.

## 7. Setup

```
npx prisma migrate deploy
npx prisma generate
node scripts/sync-permission-catalog.mjs   # adds marketing_promotions to role grants
# restart the app and the worker (npm run worker) — new queue "marketing-promotions"
```

Spend categories are created per company on first use. Grant `marketing_promotions` to further roles in Admin → Roles if needed.

## 8. Limitations (known)

- **Benefits:** line discounts only. No buy-X-get-Y, free goods, order-level, bundle or tiered-by-spend offers, and no coupons with single-use unique codes (a code is shared).
- **One use = one issued quotation revision**, not per unit or per line.
- **Segment eligibility uses a pinned snapshot.** A refreshed segment needs a new version pointing at the new snapshot. If a snapshot's member list is purged later, nobody qualifies (the promotion page says so).
- **Committed** covers purchase orders only. Signed contracts or agency retainers with no PO in the ERP aren't committed spend; record them as POs or expenses.
- **Currency:**
  - INR only, like the rest of the ERP.
  - Invoice amounts use the invoice's stored exchange rate; PO amounts use the stored base total. Expenses are always in company currency.
  - No revaluation.
- **Linking happens on the campaign's Budget panel.** The PO and invoice forms don't have a campaign field yet; their detail pages don't show it either.
- **Alerts:** evaluated on change and every 30 minutes. A Finance status change can show on the alert up to 30 minutes later, though the figures themselves are always live.
- **No ROI or attribution:** promotion use counts and budget figures are not campaign results (Phase 13).
- **Not tested in a browser** in the sandbox (no app server here).

## 9. Acceptance criteria (spec `ref/12.md` §23)

| Criterion | Status |
|---|---|
| Create and manage versioned promotions | Done (header + immutable versions; DB trigger) |
| Eligibility and lifecycle validated server-side | Done (service guards, CHECKs, triggers; tested) |
| Benefits use the existing pricing engine | Done (promotions are engine inputs; verified by engine and integration tests) |
| Stacking, precedence, limits, rounding deterministic and documented | Done (§3.3; unit tests incl. cap scaling) |
| Promotion versions traceable from quotations and orders | Done (line snapshot names the version; redemption row → quotation, revision, Sales Order) |
| Limits safe under concurrency and duplicates | Done (row lock + unique key; concurrent-issue test) |
| Integration with campaigns and audiences | Done (campaign scope, segment snapshot eligibility, campaign page panel) |
| Budget planning, approval, allocation, revision | Done (Phase 08 approved plan + allocation lines + moves) |
| Planned / committed / actual / remaining defined | Done (§4) |
| Actuals from authoritative sources | Done (Expenses and Purchase Invoices only; nothing entered by hand) |
| Multi-currency per existing rules | Done within the ERP's INR-only rule (§8) |
| Expenditure sync idempotent, handles reversals | Done by design: live calculation, no copied amounts (§4) |
| Thresholds and alerts follow the documented basis | Done (§4.2; raise-once / clear tested) |
| Permissions, tenant isolation, audit | Done (new permission module, company-scoped queries, audit rows; cross-company tests) |
| Tests | Done (see §10) |
| Documentation | This file |
| Phases 01–11 still work | Full suite run (§10) |
| No duplicate pricing / finance / campaign / order module | Respected |
| No Phase 13+ features | Respected |

## 10. Verification (sandbox, 2026-11-06)

- **Type-check:** clean on the Sales & Marketing slice including all Phase 12 paths (`tsconfig.check-p9.json`, sandbox only).
- **ESLint:** 0 errors / 0 warnings on all new and changed files.
- **Unit tests:**
  - `pricing-engine.promotions.test.ts` 8/8: promotion recorded on the applied discount; exclusive competition with rules; stacking chain; Style / category / excluded / price-list scope; minimum line value; minimum quantity in base units; dates; cap scaling;
  - `budget-math.test.ts` 11/11: actual vs pipeline; invoice moves committed to actual; committed floor; PO statuses; no approved budget; unknown line; alert kinds, over replaces warn, per-line scope, same input → same conditions.
- **Integration tests:** `promotions-budgets.integration.test.ts` 11/11 on a migrated + seeded Postgres:
  - lifecycle;
  - code vs automatic pricing; preview reserves nothing;
  - reserve / revise / accept / limit;
  - concurrent issues against a limit of 1 (exactly one succeeds);
  - cancel and expiry;
  - cross-company;
  - budget lines vs approved budget;
  - actual / committed / pipeline with PO-invoice inheritance and refusals;
  - line shrink / move / remove rules;
  - alerts raised once and cleared;
  - overview matches the panel.
- **Regression:** see the final report in the progress doc for the full-suite result.
