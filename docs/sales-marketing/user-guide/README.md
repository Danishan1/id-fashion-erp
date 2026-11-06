# Sales & Marketing — User Guide

This guide shows how to use the Sales & Marketing module of Fashion ERP from the first setup to the daily routine. It is written for the people who use the module: sales reps, sales managers, marketing staff, approvers, accountants and administrators. It does not cover how the module was built; that is in the `PHASE_*.md` files one folder up.

Start with this page. It explains what the module does, the order to set it up in, and which guide to read for each job.

---

## 1. What the module does

Sales & Marketing covers everything from a buyer's first enquiry to cash in the bank, and every campaign that brings those buyers in. It works on top of the records the ERP already has: Customers, Styles, CRM contacts and opportunities, Sales Orders, Sales Invoices, Payments and Expenses. It never keeps a second copy of them.

```
                       ┌───────────────────────── MARKETING ──────────────────────────┐
                       │ Campaign → Audience → Content → Send messages → Promotions   │
                       │       → Budget & spend → Attribution & ROI                    │
                       └───────────────────────────────┬──────────────────────────────┘
                                                       │ campaigns bring in leads & enquiries
 ┌──────────────────────────────── SALES ──────────────▼───────────────────────────────┐
 │ Enquiry → Qualify → Quotation (priced from price lists) → Approve → Issue → Accept    │
 │        → Convert to Sales Order → Invoice (Accounts) → Payment (Accounts)             │
 └──────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
 ┌──────────────────────── MANAGE & MEASURE ▼───────────────────────────────────────────┐
 │ Targets & territories · Team performance · Forecast · Commissions & incentives        │
 │ Dashboard · Analytics & reports · Workflows (reminders) · Bulk jobs · Integrations    │
 └───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Setting up the module (in this order)

Each step depends on the steps before it. An administrator usually does steps 1–6 once. The rest is set up as each area comes into use.

| # | Step | Who | Guide |
|---|---|---|---|
| 1 | Give people the right roles and permissions | Administrator | [01 Getting started](01-getting-started.md) §4 |
| 2 | Check the master data the module uses: Customers, Styles and variants, Units (with conversions such as DZN = 12 PCS), Tax rates, company GSTIN, and the CRM reporting lines (who reports to whom) | Administrator | [02 Setup & settings](02-setup-and-settings.md) §1 |
| 3 | Fill in **Settings**: approval limits, quotation validity and terms, pricing cap, forecast options, budget warning % | Sales manager / admin | [02 Setup & settings](02-setup-and-settings.md) §2 |
| 4 | Create **Sales Channels** and **Territories**, then assign reps and customers | Sales manager | [02](02-setup-and-settings.md) §3, [06](06-targets-territories-performance.md) |
| 5 | Create **Price Lists** and **Discount Rules** and have them approved | Pricing owner + approver | [05 Pricing](05-pricing-and-discounts.md) |
| 6 | Set **Targets** for the period and have them approved | Sales manager | [06 Targets & performance](06-targets-territories-performance.md) |
| 7 | Start capturing **Enquiries** and making **Quotations** | Sales reps | [03](03-enquiries.md), [04](04-quotations-and-orders.md) |
| 8 | Set up **Commission plans** and **Incentive plans** (if you pay commission) | Sales manager + Accounts | [08 Commissions](08-channels-commissions-incentives.md) |
| 9 | Marketing: campaign types and objectives, **Campaigns**, **Audience Segments**, **Content Library** | Marketing | [09](09-campaigns-and-budgets.md), [10](10-audience-segments.md), [11](11-content-library.md) |
| 10 | Connect message providers (**Channel Connections**) and send campaign messages | Admin + Marketing | [12 Sending messages](12-sending-campaign-messages.md) |
| 11 | **Promotions**, **Campaign Budgets** | Marketing + approver | [13](13-promotions.md), [09](09-campaigns-and-budgets.md) §5 |
| 12 | An **Attribution model**, approved and set as the default | Marketing manager | [14 Attribution & ROI](14-attribution-and-roi.md) |
| 13 | Switch on the **Workflows** you want (reminders, follow-ups, escalations) | Sales / marketing manager | [17 Workflows](17-workflows.md) |
| 14 | **Analytics**: save the reports people need and schedule their delivery | Managers | [15 Analytics & reports](15-analytics-and-reports.md) |
| 15 | **Integrations** with outside systems (only if needed) | Administrator | [18 Integrations](18-integrations.md) |

> **Tip:** you don't need everything on day one. Steps 1–7 give you a working quote-to-order process. Add the rest when you need it.

---

## 3. Daily, weekly and monthly routines

| When | Who | What to do | Where |
|---|---|---|---|
| Every morning | Everyone | Open the **Dashboard** and work through **Needs your attention** (overdue follow-ups, quotations to approve or expiring, budget alerts…) | Sales & Marketing → Dashboard |
| Daily | Sales reps | Log calls and notes on enquiries; move stages; set the next follow-up date; turn qualified enquiries into quotations | Enquiries, Quotations |
| Daily | Approvers | Approve or send back quotations, price lists, discount rules, campaigns, promotions and targets | The item's own page (approvals are always done by someone other than the preparer) |
| Weekly | Sales manager | Check **Team Performance** and **Forecast**; follow up on pipeline gaps | Team Performance, Forecast |
| Weekly | Marketing | Review campaign results, budget alerts and delivery runs | Campaigns, Campaign Budgets, Delivery Runs |
| Month start | Sales manager | A forecast snapshot is taken automatically; review accuracy for the month that ended | Forecast → Snapshots |
| Month end | Sales manager + Accounts | Calculate **Commission statements**, submit, approve; Accounts pays the payment request | Commission Statements |
| Monthly / quarterly | Management | Review the **Analytics** dashboards; scheduled reports arrive in **Deliveries** | Analytics |

---

## 4. All guides

| Guide | What it covers |
|---|---|
| [01 Getting started](01-getting-started.md) | Finding your way around, the dashboard, roles and permissions, ideas used everywhere |
| [02 Setup & settings](02-setup-and-settings.md) | Master data checklist, Settings, Sales Channels, campaign lists |
| [03 Enquiries](03-enquiries.md) | Capturing, qualifying and following up enquiries; importing from Excel |
| [04 Quotations & orders](04-quotations-and-orders.md) | Making, approving, issuing, revising and accepting quotations; converting to a Sales Order |
| [05 Pricing & discounts](05-pricing-and-discounts.md) | Price lists, quantity breaks, discount rules, pricing preview, price overrides |
| [06 Targets, territories & performance](06-targets-territories-performance.md) | Territories, sales credit, targets, team performance |
| [07 Forecasting](07-forecasting.md) | Pipeline forecast, trend, snapshots, accuracy, what-if scenarios |
| [08 Channels, commissions & incentives](08-channels-commissions-incentives.md) | Sales channels and agents, commission plans, incentives, monthly statements and payout |
| [09 Campaigns & budgets](09-campaigns-and-budgets.md) | Campaign lifecycle, calendar, activities, results, budget lines, spend, alerts |
| [10 Audience segments](10-audience-segments.md) | Building audiences, consent, snapshots, using them in campaigns |
| [11 Content library](11-content-library.md) | Assets, message templates, campaign content, reviews |
| [12 Sending campaign messages](12-sending-campaign-messages.md) | Channel connections (email, SMS, WhatsApp), test, send, schedule, delivery runs, unsubscribes |
| [13 Promotions](13-promotions.md) | Automatic and code promotions, limits, how they price quotations |
| [14 Attribution & ROI](14-attribution-and-roi.md) | Attribution models, recalculation, attributed revenue, ROI and ROAS |
| [15 Analytics & reports](15-analytics-and-reports.md) | Analytics dashboards, report builder, saved and shared reports, scheduled delivery, Report Center |
| [16 Bulk jobs & import](16-bulk-jobs-and-import.md) | Bulk actions, dry runs, schedules, exports |
| [17 Workflows](17-workflows.md) | Automatic follow-ups, reminders and escalations |
| [18 Integrations](18-integrations.md) | API keys, outgoing webhooks, enquiry intake, sync conflicts |
| [19 FAQ & troubleshooting](19-faq-and-troubleshooting.md) | Common questions, error messages, glossary |

---

## 5. Getting the most from the module

1. **Fill in owner, next follow-up and channel on every enquiry.** The dashboard queue, reminders, team performance and commissions all depend on them.
2. **Always quote from an enquiry** when there is one. The customer, owner, channel and campaign then flow into the quotation, the Sales Order and every report.
3. **Price from price lists, not by hand.** Prices stay consistent, approvals only trigger on real exceptions, and every price can be explained.
4. **Record the customer's decision** (accept with the PO number, or reject with the reason). Win rates, forecasts and conversions are only as good as these records.
5. **Convert accepted quotations from the quotation page.** This keeps the full trail from enquiry to order to invoice, which commissions, attribution and analytics all use.
6. **Tag records with their campaign** (lead, enquiry, quotation, order) and link campaign spend. Without this, campaign ROI can't be measured.
7. **Get approved targets in before the period starts.** Then the dashboard, forecast and incentives all have something to measure against.
8. **Switch on the workflows.** They remind people about stuck quotations, conversions and budget problems, so nothing is forgotten.
9. **Save and schedule the reports managers ask for every week.** Each recipient then gets their own copy with their own access, and nobody has to rebuild the same report.
