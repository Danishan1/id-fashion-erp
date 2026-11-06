# 15 — Analytics and reports

[← Back to the overview](README.md)

**Sales & Marketing → Analytics** is where managers explore the numbers. Every figure uses a **governed metric**: one fixed definition with a version, used the same way by the dashboard, analytics, exports and scheduled reports. Two people looking at "booked order value" therefore always mean the same thing. Everyone sees the numbers **with their own access**.

## 1. Dashboards

The **Dashboards** tab has four ready-made dashboards. Pick a period (this month, last quarter, this financial year…):

| Dashboard | Shows |
|---|---|
| **Executive** | Booked, invoiced, cash and quoted value vs the previous period; bookings by month; the enquiry funnel; top customers |
| **Sales** | Enquiries, enquiry → quotation rate, acceptance rate, average order value; bookings by rep and channel; enquiries by stage; targets |
| **Marketing** | Attributed revenue, spend, ROI, cost per order; the campaign table; enquiries by source; orders directly linked to a campaign |
| **Operations** | Workflows started and with problems, bulk-job success, webhook failures, and their breakdowns |

A widget you can't see says "Not available to you". A badge appears when the data behind a widget is not current (for example a stale attribution calculation).

## 2. Report builder

The **Report builder** tab:

1. **Data:** pick one data set. Each has one "grain", for example one row per Sales Order or one row per enquiry. Data you have no access to is greyed out.
2. **Metrics:** up to 6 of that data set's metrics. Hover a metric to see its definition.
3. **Group by:** up to 2 dimensions, such as month, rep, customer, channel, territory, campaign or stage. Grouping by *period* lets you pick the grain: day, week, month, quarter, year, financial quarter or financial year.
4. **Period:** a relative preset (last month, this financial year…) or fixed dates, up to 2 years.
5. **Compare with:** the previous period or the same period last year.
6. **Filters** on the data set's dimensions.
7. **Run report.**

The result shows:

- the period and comparison, time zone and currency;
- **freshness** per source;
- for order and invoice reports without filters, a **check** that the total matches the source table;
- metrics left out because you lack access;
- a chart and a table with totals.

Click **Records** on a row to see the actual orders, invoices or enquiries behind it, each linking to its own page.

Data sets available: enquiries, quotation revisions, booked Sales Orders, sales invoices, customer receipts, the enquiry funnel, campaign performance (attribution), targets, workflows, bulk jobs and outgoing webhooks.

## 3. Saving and sharing reports

**Save report** (needs Analytics *create*):

- name and description;
- **who can open it** (needs Analytics *edit* for anything but *Only me*):
  - only me;
  - chosen people;
  - everyone with Analytics access.
- **Whoever opens a shared report sees it with their own access.** Sharing never shows anyone data they can't already see.
- A relative period (e.g. *last month*) keeps moving: next month it shows the new last month.
- Only the owner can change a saved report. Others can save their own copy. Every change keeps a version.

## 4. Scheduled delivery

On a saved report you own (needs Analytics *edit*):

1. Add **recipients** and a format (Excel or CSV) when saving.
2. Click **Send now**, or **Add schedule**: daily, weekly or monthly at a time (India time).
3. Each recipient gets **their own copy, prepared with their own access**: an in-app notification, and a download under **Analytics → Deliveries**, valid for 7 days. Nothing is e-mailed.
4. A recipient who has lost access is **skipped**, and the reason is shown to you under Deliveries. You see who received a copy and who was skipped, never their files.
5. Pause, resume or remove schedules on the report page. They also appear in Bulk Jobs → Schedules.

## 5. Exports

The **Excel** and **CSV** buttons (needs Analytics *export*) download the report. The file includes an "About this report" section with the period, comparison, filters, currency, freshness, the metric definitions and versions, and any metrics left out. Text cells are protected against spreadsheet formula tricks.

## 6. Metric glossary and usage

- **Metric glossary:** every metric with its formula, limitations and what it must *not* be confused with. For example, invoiced value is not cash, and revenue-based ROI is not profit.
- **Usage** (S&M administrators): how often each data set is used, slow runs and failures over the last 30 days.

## 7. Report Center

The ERP's **Reports** menu → **Sales & Marketing** holds the fixed operational reports, with PDF and Excel export:

| Report | Use it for |
|---|---|
| Enquiry Register | Enquiries with stage, owner, follow-up, overdue flag |
| Quotation Register | Quotations with status (incl. expired), totals |
| Quotation → Order Conversion | Accepted quotations and whether and when they became orders |
| Target Attainment · Sales Credit Register | Targets vs actuals; who got credit for each order |
| Forecast Pipeline · Forecast Accuracy | Pipeline items and weights; forecast vs actual |
| Sales by Channel · Commission Register | Channel results; commission statement lines |
| Campaign Register · Campaign Results | Campaign status, budget; metric targets vs actual |
| Campaign Attribution & ROI · Attribution Model Comparison | Attributed revenue, spend, ROI; models side by side |

## 8. Good practice

- Start from a dashboard, then click **Report** on a dashboard tile to open the same figure in the builder and dig deeper.
- Save reports with **relative periods** and schedule them, instead of rebuilding them each week.
- Check the **freshness** badges before presenting campaign figures.
