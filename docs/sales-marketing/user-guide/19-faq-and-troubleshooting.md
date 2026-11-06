# 19 — FAQ, troubleshooting and glossary

[← Back to the overview](README.md)

## 1. Frequently asked questions

**I can't see a menu entry, a record or a figure.**
Your role doesn't include it, or the record is outside your scope (other people's records need *view all*, and other branches need branch access). Dashboard tiles you can't see say "Not available to you". Ask your administrator ([01](01-getting-started.md) §4).

**Why can't I approve my own quotation / price list / target?**
Approvals must be done by someone other than the person who prepared, last edited or submitted the item. Ask another approver.

**The quotation says "needs approval". Why?**
The reasons are listed on the page: a line discount above the limit, a total above the limit, or a price below the list price. The limits are in Settings.

**Issue was refused: "prices changed since the draft was saved".**
A price list, discount rule or promotion changed after you saved. Open the draft, check the new prices, save, and issue again.

**I can't accept a quotation.**
It has expired (its valid-until date has passed). Make a **new revision** with new dates and issue it.

**Convert to Sales Order is blocked.**
The reasons are listed. The usual ones:

- the quotation is for a prospect (use **Link customer**);
- a line's unit can't be converted to pieces;
- a quantity isn't a whole number of pieces;
- a new-item line has no Style.

**The order shows the wrong salesperson.**
On the Sales Order page use **Sales credit → Change** and give a reason. Do it before commission statements are submitted.

**My target shows "Not approved yet".**
It has no approved revision. Submit it and ask an approver.

**Why is the attribution report "out of date"?**
Records changed after the last calculation. Click **Recalculate** (or wait for the nightly run).

**ROI shows n/a.**
No actual spend is linked to the campaign in that period. Link its expenses and purchase invoices on the campaign's Budget panel.

**Some recipients were skipped when sending.**
**Check recipients** and the run page give the reasons: no address, opted out or DND, bounced earlier, or a duplicate address.

**A delivery shows "Unknown".**
The provider didn't answer in time, so we can't know whether the message went. It is never resent automatically. Close it as failed, or resend it knowing some people may get it twice.

**A scheduled report recipient got nothing.**
Look under **Analytics → Deliveries** (report owner's view). The recipient was skipped, with the reason (for example, no Analytics access or no access to the data).

**A bulk schedule stopped running.**
It paused itself after 3 failures in a row. Check the failed job, fix the cause, and resume the schedule.

**"This report took too long."**
Narrow the period, remove a dimension or add filters.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Booked order value** | Value (before GST) of Sales Orders that are Confirmed or later, by order date |
| **Invoiced value** | Posted sales invoices before GST, by invoice date. Not cash |
| **Cash collected** | Posted customer receipts, by payment date |
| **Quoted value / accepted value** | Taxable value of issued / accepted quotation revisions. Never counted as sales |
| **Sales credit** | The one rep and territory a Sales Order counts for |
| **Attainment** | Actual ÷ target. Shown as "—" without an approved target |
| **Pace** | Where you should be today if you were on track for the target |
| **Weighted pipeline** | Value × win probability of open quotations and opportunities |
| **Coverage** | Weighted pipeline ÷ amount still needed to reach target |
| **Snapshot** | A frozen copy of a forecast or a segment's members at a moment |
| **Attributed revenue** | Revenue credited to a campaign by the approved attribution model |
| **Revenue-based ROI** | (Attributed revenue − actual spend) ÷ spend. Not profit |
| **ROAS** | Attributed revenue ÷ spend |
| **Actual / committed spend** | Approved expenses + posted purchase invoices / approved POs not yet invoiced |
| **Governed metric** | A metric with one fixed, versioned definition used everywhere |
| **Freshness** | How current the data behind a figure is (Current, Refreshing, Stale, Incomplete, Failed, Unknown) |
| **Run-as user** | The person whose permissions a workflow uses (whoever switched it on) |
| **Dry run** | A bulk check that changes nothing |
| **n/a** | A ratio with nothing to divide by. Never shown as 0 |

## 3. Who to ask

| Problem | Ask |
|---|---|
| Access, roles, settings, connections, integrations | Your ERP administrator |
| Prices, discounts, quotation approvals | The sales manager / pricing approver |
| Commission payments | Accounts (Payment Requests) |
| Campaign budgets and spend | Marketing manager and Accounts |
