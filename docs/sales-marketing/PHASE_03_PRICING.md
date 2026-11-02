# Sales & Marketing — Phase 03 Pricing, price lists and discount rules (2026-10-29)

Spec: `ref/03.md`. Plan: `RELEASE_PLAN.md` (S5, widened). Scope confirmed 2026-10-29: **core engine** — default and customer price lists with versions, effective dates and approval (approver ≠ creator); per-Style prices with all-units quantity breaks; line discount rules with simple stacking; quotation auto-pricing with explanation, snapshot and controlled override; pricing preview. **Not in this phase:** customer groups (no master exists), sales-channel / regional lists, graduated tiers, multi-currency, document-level discounts, variant (colour/size) prices, rule exclusion lists, usage limits.

## 1. What existed

Nothing priced anything: Styles have no selling price, there was no price list, discount or promotion code, the ERP is INR-only, and Customer has only a free-text `type`. Reused: Style master (`products`), Category, Customer, the unit master and `convertUomQuantity` (depth-1 conversions, e.g. DZN = 12 PCS), the quotation calculator (`quotation-calc.ts` → `calculatePayableLine`) and approval rule (`quotation-approval.ts`), PermissionService (incl. self-approval guard), audit log, notifications, Sales & Marketing settings.

## 2. Price lists

- **Header** (`price_lists`): code (unique per company), name, kind **Default** or **Customer** (+ customer), currency (= company base currency, INR), priority (higher wins), active flag. Two active lists of the same kind (and customer) can't share a priority — that would make prices ambiguous.
- **Versions** (`price_list_versions`): each list has numbered versions. Status **Draft → Pending approval → Approved**; a Draft can be discarded, a Pending one declined (reason) or returned to draft. Only a Draft is editable. Approving needs `sales_pricing.approve` and must be done by someone other than whoever created, last saved or submitted the version. An approved version that hasn't started yet can be **withdrawn**. Approved versions are never edited — a change is a new version (copy of the latest one), so every price ever used stays reproducible. One open (draft / pending) version per list.
- **Dates:** a version has *effective from* (required, not in the past when approved) and optional *effective to*. On a date `d` the version **in force** is the approved one with the latest *effective from* ≤ `d`; if its *effective to* is before `d`, the list has no price on `d`. Approving a version with a later start date schedules a price change; the earlier version keeps applying until then. Two approved versions of a list can't start on the same day.
- **Entries** (`price_list_entries`): Style, unit, *from quantity*, unit price (₹, 2 decimals). Several entries for the same Style and unit with different *from quantity* are **all-units quantity breaks**: the break with the highest *from quantity* ≤ the ordered quantity prices the whole quantity (boundary inclusive: exactly 100 gets the "100+" price). The same Style + unit + from quantity can't appear twice in a version.
- Deactivating a list stops it pricing anything new; nothing already quoted changes.

## 3. Price resolution (deterministic)

For one line (Style, quantity, unit, customer or prospect, quotation date):

1. **Manual price** typed on the line — see §6.
2. **Customer price lists** of the quotation's customer (none for a prospect).
3. **Default price lists.**
4. Otherwise **no price** — the line must be priced by hand.

At a level, lists are tried by priority (high → low); the first whose version in force has an applicable entry wins. Two lists of equal priority both pricing the line is reported as a conflict (no automatic price) — normally impossible because of the priority rule in §2.

Inside a version: entries in the **line's own unit** are used first; otherwise entries in another unit that the unit master converts to (exact factor, e.g. ₹90/PCS → ₹1,080/DZN, tier checked on the converted quantity); if entries exist in several convertible units, the Style's base unit wins, otherwise it's a conflict. A unit with no conversion is never substituted. Quantity below the lowest break = this list doesn't price the line (stated in the explanation) and the next list / level is tried.

The result always says which list, version, entry and break were used and why other lists were skipped (not in force, no entry, below minimum quantity, unit not convertible).

## 4. Discount rules

`discount_rules`: code, name, **type** *% off* or *₹ off per unit*, value, **stacking** *exclusive* or *stackable*, priority, conditions (all optional, combined with AND): Style, category, customer, price list, minimum quantity; valid from / to. Lifecycle **Draft → Pending approval → Active → Inactive** (approval by someone else with `sales_pricing.approve`; only Draft / Inactive rules are edited; an inactive rule is submitted again to come back).

- Rules apply only to lines priced from a price list (never to a hand-entered price).
- *₹ off per unit* and *minimum quantity* are in the Style's base unit (normally PCS) and converted to the line unit (₹5/PCS = ₹60/DZN); if the line unit doesn't convert, the rule doesn't apply (explained).
- **Order:** P = list unit price in the line unit.
  - *exclusive* rules: each one's discount on P; the biggest wins (tie: higher priority, then code).
  - *stackable* rules: applied one after another by priority (then code) on the **already reduced** price; % on the running price, ₹ amounts subtracted; never below zero.
  - The line gets whichever is larger: the best exclusive rule alone, or all stackable rules together (tie → the exclusive rule).
  - Optional company cap (*Sales & Marketing → Settings → maximum rule discount %*): the total rule discount is cut to that % of P.
- **Net unit price** = P − rule discount, rounded half-up to the paisa **once** at the end (no intermediate rounding). It never goes below zero.
- The salesperson's own line *discount %* still applies on top, through the existing quotation calculation and approval rule (D2).

## 5. Calculation order on a quotation line

1. Resolve price (§3) in the line unit — unrounded after unit conversion.
2. Rule discounts (§4) → net unit price (rounded to 2 dp).
3. Existing quotation maths (unchanged): gross = qty × net price; manual discount %; taxable; GST from the Tax Rate master; charges; totals. See `quotation-calc.ts`.

All money values come from the server; the editor only previews.

## 6. Quotations

- Each line stores its **price source** (*price list* / *manual* / *override*), list price, rule discount, the engine's calculated price, an override reason and a **pricing snapshot** (JSON: list, version, entry, break, unit conversion, rules with their values, explanation).
- **Auto:** a Style / design line priced from a list is recalculated on every draft save with the quotation's date and customer. The editor shows "List ₹100 · 100+ pcs · Customer list ABC v2 · Rules −₹5 (BULK5) → ₹95".
- **Manual:** no list prices the line → the salesperson types the price (as before).
- **Override:** a list prices the line but the salesperson types another price → needs `sales_quotations.override` and a reason; a price **below** the calculated price adds an approval reason ("Line 2: ₹80 is below the price-list price ₹95"), so the quotation goes through the existing approval. The override is never replaced by a recalculation; "Use list price" puts the line back on auto.
- **Before submit / issue** the server re-prices: if an auto price changed since the draft was saved (a list or rule changed), the action is refused until the draft is saved again — nobody issues a price they didn't see.
- **Issued revisions are frozen** with their snapshot; list or rule changes never touch them. A new revision copies the lines and re-prices auto lines on its own date when saved.
- Converting to a Sales Order (S4) keeps using the line's taxable value ÷ pieces — unchanged.

## 7. Preview and API

- `/sales-marketing/pricing/preview` (`sales_pricing.view`): Style, quantity, unit, customer (optional), date → full explanation including skipped lists and rules. Creates nothing.
- `POST /api/v1/sales-marketing/pricing/calculate` — up to 200 lines per call; used by the preview and the quotation editor (allowed with `sales_pricing.view` or `sales_quotations.create`/`edit`). Pure read; safe to retry.
- Internal: `priceLines(actor, context, lines)` in `pricing.service.ts` — the interface a later module (e.g. Sales Order pricing) calls; it must store the returned snapshot with its own document and never re-price a finalised document.
- Price lists: `/api/v1/sales-marketing/pricing/price-lists[/:id[/versions[/:versionId[/actions/:action]]]]`; discount rules: `/api/v1/sales-marketing/pricing/discount-rules[/:id[/actions/:action]]`.

## 8. Permissions, audit, history

New module **`sales_pricing`**: view (lists, rules, preview, customer prices), create, edit (drafts, submit, withdraw, new version, discard, deactivate), approve / reject. Granted: MANAGEMENT view/approve/reject/export; MERCHANDISER view/create/edit/export; SUPER_ADMIN everything. `sales_quotations.override` (existing catalog action) granted to MANAGEMENT and MERCHANDISER. Every change writes an audit row and a `pricing_events` row (shown as history on the list / rule).

## 9. Database

Migration `20261029120000_sales_pricing_phase3`: `price_lists`, `price_list_versions`, `price_list_entries`, `discount_rules`, `pricing_events`; six enums; six pricing columns on `quotation_lines` (existing lines become MANUAL); `sales_marketing_settings.pricing_max_rule_discount_percent`; partial unique indexes for "one open version per list", "one approved version per start date", "one active list per kind / customer / priority"; CHECKs on prices, dates and rule values; the `sales_pricing` permissions and `sales_quotations.override` grants. Rollback `prisma/rollback/20261029120000_sales_pricing_phase3.down.sql` (run before S4's) — rehearsed on a scratch copy: schema identical to before.

## 10. Verification (cloud sandbox, Postgres 16)

- `pricing-engine.test.ts` (25): units, version in force / scheduled / ended, customer vs default, priority and equal-priority conflict, skipped-list reasons, all-units breaks at exact boundaries (99.999 / 100 / 499 / 500), below-minimum fallback, PCS → DZN conversion, own-unit preference, unconvertible units, base-unit preference / conflict, % and ₹-per-unit rules (converted), exclusive best-of with tie-break, stackable sequence, exclusive vs stack (incl. tie), all conditions, never below zero, company cap, half-up rounding once, determinism and explanation text.
- `pricing.integration.test.ts` (real DB, 7): list lifecycle (validation, self-approval refused, frozen approved version, one open version, decline / resubmit, scheduled price change, withdraw, history + audit rows); priority clash on create / reactivate; past start date; discarding the only draft deletes the list; customer vs default vs prospect, breaks, DZN, tenant isolation (another company sees nothing); rules (approval, conditions, exclusive vs stacked, cap, deactivate, self-approval, editing an active rule refused); quotations (auto price + snapshot, override needs reason and `override` permission, same price = list price, AUTO without a list refused, below-list override → approval reason, above-list doesn't); issue refused after a rule changed the price until the draft is saved again, issued quotation unchanged; two concurrent approvals → one wins.
- Route tests (permissions), component tests (price list detail actions by status / role, draft save payload, preview; quotation editor auto price, explanation, override reason, approval note, "use list price").
- Existing S2–S4 quotation, conversion and CRM suites pass unchanged.
- Full suite: 4,038 passed, 9 skipped (4,047). `tsc` clean, ESLint 0 errors (16 existing warnings, none new), `next build` OK.
- Live (production build, real browser): created a price list in the UI (Cargo Shorts ₹500, ₹450 from 100 PCS), submitted and approved it ("In force"); approved a 5 % stackable rule for that list; pricing preview for 120 PCS → ₹427.50; new quotation for 10 DZN → editor auto-filled ₹5,130.00 read-only ("list ₹5,400.00 · rules −₹270.00 → ₹5,130.00"); changed it to ₹5,000 with a reason → saved as an override, and the quotation shows "Needs approval before issue: Line 1: price ₹5,000.00 is below the price-list price ₹5,130.00". No browser errors.
