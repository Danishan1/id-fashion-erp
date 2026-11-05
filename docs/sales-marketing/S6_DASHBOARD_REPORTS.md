# Sales & Marketing — Release 1 / S6 Dashboard KPIs and reports (2026-11-02)

Spec: `ref/02.md` §7.7, `ref/04.md` §10.4. Plan: `RELEASE_PLAN.md` (S6). Closes Release 1 (Quote-to-Order).

## 1. Dashboard KPIs (Sales & Marketing → Dashboard)

The "Not available yet" panel is replaced by real figures (`/api/v1/sales-marketing/metrics?days=30|90|365`, `sales-marketing-metrics.service.ts`). Every figure counts only records the viewer can see — the same rule as the enquiry and quotation lists (own / CRM team, or everything with `view_all`) — and an area is shown only with its permission.

| Figure | Definition |
|---|---|
| Open enquiries | stage not Won / Lost / Not qualified, not cancelled in Merchandising (now) |
| Overdue follow-ups | open, next follow-up before today |
| Awaiting qualification | open at New or Under review |
| Enquiry → quotation | enquiries dated in the period with at least one *issued* quotation ÷ enquiries dated in the period |
| Quotations by status | count and current-revision total incl. GST, now: Draft, Waiting for approval, Approved not issued, Issued awaiting decision, Expired (issued, past valid-until), Accepted not yet ordered |
| Win rate | customer decisions recorded in the period: accepted ÷ (accepted + rejected), per revision |
| Quote → order | revisions accepted in the period that already have a Sales Order ÷ accepted in the period |
| Orders from quotations | Sales Orders created from a quotation in the period: count and value (before GST); needs `sales_orders.view`, branch-scoped like the Sales Orders list |
| Top customers | accepted value (incl. GST) in the period, top 5 |

No figure is invented; with no data the tiles show 0 or "—" (a rate with nothing to divide by).

## 2. Reports (Report Center → Sales & Marketing)

New report category `sales-marketing` (needs `reports.view` + `sales_marketing.view` + `sales_quotations.view`). The report framework now passes the viewer to each report (`buildDescriptor(companyId, name, filters, viewer)`; existing reports ignore it) so these reports apply the viewer's record visibility. Screen and Excel / CSV / PDF exports use the same builder.

- **Enquiry Register** — by enquiry date; stage, customer, owner filters; customer / prospect, subject, source, owner, priority, stage, next follow-up (+ "Overdue"), line and quotation counts; links to the enquiry.
- **Quotation Register** — by the current revision's quotation date; status (incl. a derived "Expired"), customer, owner filters; revision, enquiry, owner, status, valid until, taxable, GST, total; totals over the whole filtered set; links to the quotation.
- **Quotation → Order Conversion** — revisions accepted in the date range (by acceptance date); customer and result (converted / awaiting) filters; quoted taxable value, customer reference, Sales Order number / date / live status / value (before GST), days from acceptance to order; totals: accepted, converted, conversion %, quoted and ordered value. Order details are shown only to people who can view that Sales Order (`sales_orders.view` and branch access) — others see "(no access)".

Registers show at most 5,000 rows and say so when there are more.

## 3. Verification (cloud sandbox, Postgres 16)

- `sales-marketing-s6.integration.test.ts` (real DB, 5 tests): every KPI asserted exactly in a rep's own scope (open 2, overdue 1, awaiting qualification, enquiry → quotation 50 %, draft / issued / expired counts and values, win rate 50 %, quote → order 100 %, top customer); another rep sees none of it; the manager sees at least as much; order figures disappear without order access. Each report's rows, filters (stage; status incl. expired vs issued; dates; result), totals, record scope and the "(no access)" order masking; invalid filters → validation error.
- Route tests: metrics permission + period; the report routes pass the viewer to the report. Component test: dashboard KPI tiles, rates and period switch.
- Full suite: 4,043 passed, 9 skipped, 3 failed — all three are CRM-workflow integration tests (bulk-action workflow trigger, default automations, workflow events) that time out under full-suite load; none touches S6 code and each passed when re-run on its own. `tsc` clean, ESLint 0 errors (16 existing warnings), `next build` OK. No migration in this step.
- Live (production build, real browser): dashboard shows the KPI tiles with the sandbox data (3 open enquiries, 1 overdue, 2 drafts ₹72,398.88, 2 accepted not yet ordered ₹1,82,658.00, win rate 100 %, quote → order 33.3 %, 1 order from quotations ₹2,760.00) and the 30 / 90 / 365-day switch; the Report Center shows the Sales & Marketing category with 3 reports; each report renders with its filters and exports to Excel (200); the conversion report lists QUO-2026-00005 → ORD-2026-00001 (₹2,760, 0 days) and two accepted quotations awaiting conversion — consistent with the dashboard.
