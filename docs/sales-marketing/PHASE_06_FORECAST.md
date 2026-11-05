# Sales & Marketing — Phase 06 Sales forecasting (2026-11-03)

Spec: `ref/06.md`. Plan: `RELEASE_PLAN.md` (R2.6, widened). Scope confirmed 2026-11-03:

- **Core**: a live forecast per month / quarter / year with two methods — **pipeline-weighted** (booked so far + weighted open pipeline) and **moving-average trend** — compared with Phase 05 approved targets for the company, reps, teams and territories; **snapshots** (manual + one automatic per period) with **accuracy** once a period has ended; simple saved **what-if scenarios**.
- **Pipeline = open quotations + open CRM opportunities, never counted twice.**
- **Quotation probability**: editable defaults per quotation status in Sales & Marketing settings; a linked opportunity's own probability wins.
- **Snapshots**: "Save snapshot" button + one automatic snapshot per company at the start of each month (and of each quarter / year), by the existing background worker.

**Not in this phase:** weekly periods, configurable forecast definitions, backtesting of methods against reconstructed past data (impossible without past snapshots — accuracy builds up from snapshots taken from now on), seasonal / growth-fitted models, confidence intervals, channel / product / segment dimensions (no reliable masters for them yet), AI, notifications.

## 1. What existed (reused)

Phase 05 `metricTotals()` (booked order value — the **forecast metric**), fiscal periods (`performance-periods.ts`), approved targets, visibility scope (`getPerformanceScope`), team = CRM reporting tree. CRM opportunities (amount, currency, probability with stage default, expected close date, status OPEN / WON / LOST / ABANDONED, owner, ERP links), quotations and their current revision (status, taxable value, valid-until, owner, customer, enquiry), the background worker (BullMQ, `upsertJobScheduler`), Sales & Marketing settings. No forecast existed anywhere.

## 2. The forecast metric

**Booked order value** (Phase 05 definition: Sales Orders Confirmed or later, order value before GST, by order date, credited to the order's rep / territory). Forecasts estimate this one metric only. A forecast is never shown as an order, an invoice, revenue or cash; screens label it "Forecast" and keep actual, pipeline, forecast and target in separate columns.

## 3. Open pipeline (eligibility and de-duplication)

Each pipeline item has: value (₹ before GST), probability (0–100 %), expected date, rep, territory, source.

**Quotations** (current revision):

| Quotation status | In pipeline? | Default probability (settings) | Expected date |
|---|---|---|---|
| Approved (not issued) | yes | 30 % | linked opportunity's expected close date if set, else valid-until |
| Issued, valid-until today or later | yes | 50 % | as above |
| Issued, valid-until passed (expired) | **no** — listed as "expired, excluded" | — | — |
| Accepted, no Sales Order yet | yes | 90 % | today (it is waiting to be converted now) |
| Draft, Pending approval, Rejected, Cancelled, Converted | no (converted ones are already actuals) | — | — |

Value = current revision's taxable total (lines after discount, before charges and GST — the same basis as order value). Credit = quotation owner (else creator); territory = the customer's territory now (as Phase 05).

**Opportunities**: status Open, not archived, with an amount. Value = amount (currency must be the company currency or empty; other currencies are excluded and listed — no conversion is invented). Probability = the opportunity's probability (it already defaults from its CRM stage). Expected date = expected close date. Credit = owner (else creator); territory = the territory of the ERP customer linked to its CRM company, if any.

**No double counting.** An opportunity is left out ("represented by quotation …" / "already ordered") when it is linked — directly (`crm_opportunity_erp_links` QUOTATION) or through a linked enquiry (BUYER_ENQUIRY → its quotations) — to any quotation that is in the pipeline, accepted or converted, or when it is linked to a Sales Order (ERP link or `originatingOpportunityId`). A linked quotation that is only Draft / Rejected / Cancelled doesn't hide the opportunity.

**Excluded, and listed with the reason** (never put in an arbitrary period): no expected date, expected date before today ("overdue"), no amount / value 0, no probability, other currency, expired quotation. Probabilities are clamped to 0–100.

## 4. Methods (`forecast-methods.ts`, one strategy each, same input / output)

**Pipeline-weighted (default).** For a period P and today T:

- past period (ended): forecast = actual (nothing left to forecast);
- otherwise: forecast = actual booked so far in P + Σ (value × probability) of pipeline items whose expected date falls in [max(T, start of P), end of P].

Each item shows its weighted value; the totals show unweighted pipeline too.

**Moving-average trend.** forecast(P) = average booked order value of the N complete periods of the same type just before P (N = settings, default 3). Requires N complete periods on or after the company's first booked order; otherwise "not enough history" (no number). Zero periods count as zero. No growth or seasonality is applied (a scenario can add a growth %). For the current period it is a whole-period estimate, shown next to the actual so far.

Rows (reps / teams / territories) use the same rules on their own credit. Team = manager + everyone below (Phase 05); every item and order credits one rep, so a team total is a plain sum and never double counts. The company figure is computed once over all items (not summed from rows), so items with no rep / territory are included there.

## 5. Targets, gap, coverage

Per row: approved Phase 05 target (booked order value, same period), actual to date, forecast, **forecast − target**, forecast ÷ target %, **still needed** = target − actual, **coverage** = weighted pipeline ÷ still needed (only when still needed > 0). Targets are never used as evidence of expected sales.

## 6. Snapshots and accuracy

A snapshot stores, for one period: when it was taken (cutoff = that moment), kind (manual / automatic), the settings used, the company figures and every rep / team / territory row for both methods, and the pipeline items with their value, probability and weighted value (references + numbers only, not copies of the documents). Snapshots are never recalculated or overwritten.

- **Automatic**: the worker (every 6 hours) takes one snapshot per company for the current month — and for the current quarter / year when today is in their first month — if none exists yet for that period (partial unique index), so a restart or retry never makes a second one. A snapshot taken after the 3rd day of the period is marked "late".
- **Manual**: "Save snapshot" (with a note) any time, any number.

**Accuracy** (when the period has ended; actual = booked order value now, by the same definition):

- error = forecast − actual; absolute error |error|; % error = error ÷ actual (only when actual > 0, otherwise "n/a").
- Over several ended snapshots (automatic ones only, so cutoffs are comparable — start of period): **MAE** = mean |error|; **WAPE** = Σ|error| ÷ Σ actual (n/a if Σ actual = 0); **bias** = Σ error ÷ Σ actual (positive = forecasts too high). MAPE is not shown (unstable near zero actuals).
- Until periods end there is no accuracy; the screen says so instead of inventing past forecasts.

## 7. Scenarios

A saved scenario = name, period, assumptions; results are calculated live next to the baseline, and the last result is stored with its time when saved. Assumptions (only those the methods use): **probability factor** (0–200 % of every probability, capped at 100 %), **slip** (expected dates moved later by 0–365 days), **include overdue items** in the current period, **leave out** quotations or opportunities, **trend growth** (−100 … +200 %). Shown: baseline, scenario, difference, difference %, all marked "hypothetical". Scenarios never change any CRM, quotation, order, target or setting.

## 8. Data-quality warnings

Shown on the forecast page with the count and value affected: excluded items by reason (no date, overdue, no amount, no probability, other currency, expired quotations), opportunities not updated for N days (settings, default 60 — "stale"), default (not measured) quotation probabilities in use, not enough history for the trend, no approved target, forecast more than 20 % below target.

## 9. Who sees what

Reuses Phase 05's `sales_performance` module: **view** = the forecast in the viewer's scope (own, team, assigned territories; company figures and excluded-items detail with `view_all`); **create** = save snapshots and scenarios; **edit** = change / archive scenarios. Settings need `sales_marketing_settings.edit`. Pipeline drill-down links only to records the viewer may open.

## 10. Screens and reports

- **Sales & Marketing → Forecast**: period picker; overview (actual, weighted pipeline, forecast by both methods, target, gap, coverage); a bar chart of the last periods' actuals with targets and the forecast; rep / team / territory tables; pipeline items (included and excluded with reasons); warnings; Save snapshot.
- **Forecast snapshots**: list; detail with accuracy once the period has ended; accuracy summary (MAE, WAPE, bias).
- **Scenarios**: list, create, detail (baseline vs scenario).
- **Settings**: quotation probabilities, trend look-back, stale days.
- **Reports**: *Forecast Pipeline* (items, weights, exclusions) and *Forecast Accuracy* (ended snapshots).

## 11. Code map

- Migration `prisma/migrations/20261103150000_sales_forecast_phase6` (rollback `prisma/rollback/20261103150000_sales_forecast_phase6.down.sql`): `sales_forecast_snapshots` (partial unique index: one AUTO per company + period; CHECK manual ⇔ creator), `sales_forecast_scenarios`, five forecast settings with range CHECKs. No new permissions (reuses `sales_performance`).
- `src/modules/sales-marketing/forecast/`: `forecast-methods.ts` (pure: pipeline-weighted, moving-average trend, assumptions, target comparison, accuracy), `forecast-pipeline.ts` (eligibility + de-duplication), `forecast.service.ts` (assembles rows / warnings / chart in the viewer's scope; actuals only through Phase 05 `metricTotals`), `forecast-snapshot.service.ts` (manual + automatic snapshots, accuracy), `forecast-scenario.service.ts`, `forecast-jobs.worker.ts` (registered in `src/core/jobs/worker.ts`, every 6 h).
- APIs `/api/v1/sales-marketing/forecast` (+ `/snapshots`, `/snapshots/[id]`, `/accuracy`, `/scenarios`, `/scenarios/preview`, `/scenarios/[id]`, `/scenarios/[id]/archive`).
- Screens `/sales-marketing/forecast`, `/forecast/snapshots[/id]`, `/forecast/scenarios[/new|/id]`; settings section *Forecast*. Reports `src/modules/reports/sales-forecast.reports.ts` (Forecast Pipeline, Forecast Accuracy).

## 12. Verification (sandbox, 2026-11-03)

- Real-DB integration (`forecast.integration.test.ts`, 7 tests): pipeline eligibility (issued / approved / accepted quotations with settings defaults, opportunity probability winning for a linked quotation, expired / no date / other currency / already ordered / represented excluded with reasons, overdue not counted), exact per-rep forecast = booked + weighted, team and company roll-ups, visibility (rep / manager / outsider / view_all), target gap / still needed / coverage, scenarios (factor, overdue, slip, validation, no record changed, stored result privacy, version guard, archive), snapshots (immutable after a data change, rep sees own rows only, automatic once per period, no snapshot of an ended period), accuracy (ended periods only, no % error on a zero actual), both reports.
- Unit: methods (window, overdue, assumptions, trend sufficiency, zero targets, MAE / WAPE / bias), routes, worker, screens (overview, warnings, items / left out, chart table, save snapshot, scenario comparison).

## 13. Known limitations

- One metric (booked order value). Opportunity and quotation credit follow their current owner / customer territory (they store no snapshot); booked actuals use the stored Phase 05 order credit.
- Opportunities in another currency are left out (no conversion). Quotation probabilities are chosen defaults until enough history exists to measure real conversion rates (Phase 06 doesn't infer them).
- The trend uses the company's first booked order to judge "enough history" for every row (a new rep's earlier zero periods count as zero).
- Accuracy builds up only from snapshots taken from now on; it needs the background worker running (`npm run worker`) for automatic snapshots.
- Everything is calculated live on each request (fine at this ERP's size).

## 14. Phase 07 groundwork

Commission (Phase 07) should read booked / invoiced figures through `metricTotals()` and the Phase 05 order credit — not the forecast. Channels (Phase 07) would become a new row dimension here once a channel is stored on quotations / orders.
