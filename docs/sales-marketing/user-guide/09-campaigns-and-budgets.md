# 09 — Campaigns and campaign budgets

[← Back to the overview](README.md) · Next: [10 Audience segments](10-audience-segments.md)

A campaign is any planned marketing effort: a trade show, an e-mail series, a sampling drive, a WhatsApp offer. The campaign record holds the plan, approvals, budget, activities and results. Its audience, content, messages, promotions and ROI are covered in the next guides.

## 1. Creating a campaign

**Sales & Marketing → Campaigns → New.**

- **Code** and **name**.
- **Type** and **primary objective** (from the lists in Campaigns → Settings).
- **Owner**, **department**, **sales channel**, **parent campaign** (for sub-campaigns), **priority**.
- **Planned dates** and **planned budget**.
- **Success metrics:** targets for system-measured figures (leads, converted leads, enquiries, accepted quotation value, booked order value, invoiced value) and manual ones such as booth visitors.

## 2. Lifecycle

```
Draft → submit → Waiting for approval → approve → Approved → Activate → Active ⇄ Paused → Complete
                       └─ send back (reason) → Draft                              Any open → Cancel (reason)
```

- The approver can't be the preparer. If your company switched approval off (Sales & Marketing → Settings → *Campaigns need approval*), submitting approves at once.
- **Activate** records the actual start. It doesn't send anything by itself.
- **After approval, planned dates and planned budget change only through a new revision** (proposed values + reason) that someone else approves. Until then the approved values stay. Name, description, owner and similar fields stay editable.

## 3. Activities and the calendar

- **Activities** are CRM tasks, calls and meetings on the campaign. A **milestone** is a task flagged as one. They appear in CRM *My Tasks*, the CRM calendar and its reminders. You need CRM access to see the activity panel.
- **Campaign Calendar:** a month view of campaigns (planned and actual bars) with activity and milestone due dates, filterable by owner, status and type.

## 4. Linking records and measuring results

Set the **campaign** on CRM leads, enquiries, quotations and Sales Orders. It carries forward enquiry → quotation → order. On the campaign page, **metrics** count the linked records:

- leads and converted leads;
- enquiries;
- accepted quotation value / count;
- booked order value / count;
- invoiced value.

Manual metrics show who entered them and when.

> These are *linked-record counts*. For a fair share of credit when several campaigns touched the same customer, use [14 Attribution & ROI](14-attribution-and-roi.md).

The campaigns list opens with an **overview**: counts by status, waiting for approval, starting in 30 days, past their planned end, overdue activities, and campaigns missing a target or budget.

## 5. Budgets and spend

**Sales & Marketing → Campaign Budgets** (and the campaign's **Budget** panel).

| Measure | Meaning |
|---|---|
| Approved | The campaign's approved planned budget |
| Allocated | Sum of its budget lines |
| **Actual** | Approved / partly paid / paid **Expenses** + posted **Purchase Invoices** linked to the campaign, before GST |
| **Committed** | Approved purchase orders linked to the campaign, not yet invoiced |
| Pending | Expenses waiting for approval, draft POs and invoices: shown, not counted |
| Remaining | Approved − actual − committed |
| Used % | (Actual + committed) ÷ approved |

**Budget lines:** split the approved budget into lines by **spend category** (and optionally by delivery channel).

- Use **Move budget** to shift money between lines; a reason is needed.
- A closed line takes no new spend.
- Lines can never add up to more than the approved budget.

**Linking spend:** on the campaign's Budget panel, link Expenses, Purchase Orders and Purchase Invoices (with the budget line). The finance records stay in Accounts and Purchase; nothing is copied, so a cancelled PO or rejected expense simply drops out.

**Alerts**, raised once each and sent to the owner:

- **Warning:** used % reached the Settings threshold (default 80 %);
- **Over budget:** actual + committed is above the limit;
- **Over-allocated:** the lines add up to more than the approved budget;
- **Ended with open commitments.**

Open alerts appear on the dashboard queue.

## 6. Reports

Report Center → Sales & Marketing: **Campaign Register** and **Campaign Results**. Campaign exports with budget figures are available as a bulk action.

## 7. A good campaign routine

1. Create the campaign with **targets** and a **planned budget**, then submit.
2. Once approved: add **budget lines**, the **audience** ([10](10-audience-segments.md)), the **content** ([11](11-content-library.md)) and the **channels** ([12](12-sending-campaign-messages.md)).
3. **Activate** on the start day and send.
4. Tag every lead, enquiry and quotation it brings in with the campaign.
5. Link every expense, PO and invoice as it happens.
6. **Complete** it, then review results, budget and ROI ([14](14-attribution-and-roi.md)).
