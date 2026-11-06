# 01 — Getting started

[← Back to the overview](README.md)

## 1. Finding the module

Open **Sales & Marketing** in the left sidebar. You only see the menu entries your role allows. If you think an entry is missing, ask your administrator (see §4).

| Menu entry | What it is for |
|---|---|
| Dashboard | Your home page: headline figures, what needs your attention, team & targets, system health |
| Enquiries | Buyer enquiries and their sales follow-up |
| Quotations | Quotations, approvals, revisions, customer decisions, conversion to Sales Orders |
| Price Lists · Discount Rules · Pricing Preview | Selling prices and automatic discounts |
| Team Performance · Forecast · Sales Targets · Territories | Targets, results against them, and the forecast |
| Commission Statements · Commission Plans · Incentive Plans | What reps and agents earn and get paid |
| Sales Channels | The list of channels sales are credited to |
| Campaigns · Campaign Calendar · Campaign Budgets | Planning and running marketing campaigns and their money |
| Audience Segments | Who a campaign is aimed at |
| Content Library | Images, documents and message templates, with review |
| Promotions | Price promotions (automatic or by code) |
| Attribution & ROI | Which campaigns earned the revenue, against their spend |
| Delivery Runs · Channel Connections | Sending campaign messages, and the provider accounts used |
| Workflows | Automatic follow-ups and reminders |
| Integrations | API keys and webhooks for other systems |
| Analytics | Dashboards, report builder, saved and scheduled reports |
| Bulk Jobs | Background bulk actions, exports and schedules |
| Settings | Module settings (administrators) |

## 2. The dashboard

**Sales & Marketing → Dashboard** opens first. Use the period picker at the top (default: *This month*). Every figure is compared with the previous period of the same length.

- **Headline figures:**
  - booked order value, invoiced value (before GST), cash collected, quoted value;
  - enquiries received, quotation acceptance rate;
  - attributed revenue, revenue-based ROI.

  Each tile shows the change from the previous period. **Open list** goes to the records behind the figure. **Report** opens the same figure in the Analytics report builder, if you have Analytics access.
- **Bookings:** a chart of booked order value over the period.
- **Needs your attention:** your to-do list. It counts only the things you can act on: overdue enquiry follow-ups, enquiries to qualify, quotations to approve or about to expire, accepted quotations not yet ordered, campaigns and promotions to approve, budget alerts, workflow problems and sync conflicts. Click a line to open the list.
- **Enquiry funnel:** how far this period's enquiries have got: qualified, quoted, accepted, ordered, invoiced.
- **Team & targets:** top reps, channels and customers; targets with the lowest attainment first.
- **System health:** whether the background processes are fine (attribution calculation, message sending, integrations, bulk jobs, report deliveries).

If a tile says **"Not available to you"**, your role can't see that data (for example, invoices need Accounts access). The tile never shows a false zero.

## 3. Ideas used everywhere

| Idea | What it means for you |
|---|---|
| **Your own scope** | You see your own records and your team's (CRM reporting lines). People with *view all* see everyone's. Figures, lists, dashboards and reports all follow the same rule. |
| **Approval by someone else** | Quotations above limits, price lists, discount rules, targets, campaigns, promotions, content, commission plans and statements need approval, and the approver can never be the person who prepared or submitted the item. A Super Admin is the only exception. |
| **Versions** | Approved items are never edited. To change an approved price list, target, promotion, model or plan, create a **new version** and have it approved. The old version stays in the history. |
| **Reasons** | Closing, cancelling, declining, overriding and similar actions ask for a reason. It is kept in the history and audit log. |
| **India dates** | Days and periods are India dates (Asia/Kolkata). Financial quarters and years follow your company's financial-year start month. |
| **Base currency** | Amounts are in the company's base currency (₹). Order, invoice and spend figures are **before GST** unless the label says "incl. GST". |
| **n/a** | A rate or ratio with nothing to divide by (for example ROI with no spend) shows **n/a**, never 0. |
| **History** | Every record page has a history or timeline showing who did what and when. |

## 4. Roles and permissions (for administrators)

Permissions are set per area in **Administration → Roles**. The standard roles start with these defaults:

| Area (permission module) | Management | Merchandiser (sales) | Viewer |
|---|---|---|---|
| Enquiries (`sales_marketing`) | as CRM | as CRM | view |
| Quotations (`sales_quotations`) | view all, approve, reject, override price, export, print | create, edit, cancel, override price, export, print | view |
| Pricing (`sales_pricing`) | view, approve, reject, export | view, create, edit, export | — |
| Targets & performance (`sales_performance`) | everything | view, export | — |
| Commissions (`sales_commissions`) | everything | view own, export | view |
| Campaigns (`marketing_campaigns`) | everything | view, create, edit, export | view |
| Segments (`marketing_segments`) | view all, create, edit, archive, export | view, create, edit, export | — |
| Content (`marketing_content`) | incl. approve / reject | create, edit | view |
| Message sending (`marketing_delivery`) | view all, create, edit, cancel, export | view, create, edit, cancel | view |
| Promotions (`marketing_promotions`) | incl. approve / reject | view, create, edit | view |
| Attribution (`marketing_attribution`) | incl. approve / reject | view, export | — |
| Workflows (`sales_workflows`) | view, edit, approve | — | view |
| Integrations (`sales_integrations`) | view, edit, approve | — | view |
| Analytics (`sales_analytics`) | view, create, edit (share and schedule), export | view, create, export | view |
| Settings (`sales_marketing_settings`) | view, edit | — | view |

Things to remember:

- **The data needs its own module too.** Analytics, the dashboard and the reports show only what the person's other permissions allow. For example, invoice and cash figures need *Accounts* view, and Sales Order figures need *Sales Orders* view.
- **Branches.** People restricted to certain branches see only those branches' orders, invoices and payments.
- **Approvers** need the *approve* action on that area. They also must not be the item's preparer.

## 5. Where to go next

- Setting the module up? → [02 Setup & settings](02-setup-and-settings.md)
- Selling? → [03 Enquiries](03-enquiries.md) and [04 Quotations & orders](04-quotations-and-orders.md)
- Marketing? → [09 Campaigns & budgets](09-campaigns-and-budgets.md)
