# 06 — Territories, targets and team performance

[← Back to the overview](README.md)

## 1. Who gets the credit for a sale

Every Sales Order stores **one sales rep** and **at most one territory**. This "sales credit" is what targets, performance, forecasts and commissions count.

When an order is created, the system sets the credit automatically:

- **Rep:** the first of these that exists:
  1. the owner of the converted quotation;
  2. the owner of the customer's CRM company;
  3. the territory's primary rep;
  4. whoever created the order.
- **Territory:** the customer's territory at that moment.

**Changing it:** on the Sales Order page, **Sales credit → Change**. Pick the rep and/or territory and give a reason; the change is logged. Moving a customer to another territory later never changes orders already booked.

## 2. Territories

**Sales & Marketing → Territories.**

1. **New territory:** code, name, description.
2. **Reps:** add the reps who cover it, with from / to dates. Mark one as **primary**; only one primary at a time. A rep can cover several territories.
3. **Customers:** add customers to the territory. A customer belongs to at most one territory; use **Move** to change it.
4. **Deactivate** a territory you stop using. Its orders keep it.

## 3. Targets

**Sales & Marketing → Sales Targets → New target.**

| Field | Choices |
|---|---|
| Scope | **Rep** (a person), **Team** (a manager and everyone below them), **Territory**, **Company** |
| Metric | Booked order value, booked orders (count), booked quantity (pieces), accepted quotation value, accepted quotations (count), invoiced value |
| Period | Month, quarter or year (quarters and years follow your financial year) |
| Value | The target |

1. Save the draft and **submit for approval**. Someone else approves, or sends it back with a reason.
2. A target with no approved revision shows **"Not approved yet"**. A draft value is never shown as the target.
3. **Changing an approved target:** create a new revision and have it approved. The old one is kept as *Superseded*. Revisions approved after the period started are marked.
4. After the period **ends**, targets are frozen (no retrospective changes). Old ones can be **archived** with a reason.

> **Tip:** approve next month's and next quarter's targets before the period starts. The dashboard, forecast and incentives all measure against them.

## 4. What counts as a sale

| Metric | Counts | Date |
|---|---|---|
| Booked order value / orders / quantity | Sales Orders that are Confirmed, In production, Dispatched, Invoiced or Closed, or On hold from one of those. Drafts and cancelled orders never count | Order date |
| Accepted quotation value / count | Accepted quotation revisions (lines after discount, before charges and GST). **Never** added to booked sales | Customer's decision date |
| Invoiced value | Posted Sales Invoices, before GST. Not reduced by returns (the ERP has no sales credit notes) | Invoice date |

## 5. Team performance

**Sales & Marketing → Team Performance.** Pick a metric and period. You see:

- your own figures;
- **rep ranking**, **teams** and **territories**, each with target, actual, gap, attainment % and **pace** (where you should be by today for the current period);
- click any row to see the orders, invoices or quotations behind the number.

You see yourself, your team and your territories; with *view all*, everyone. Attainment shows "—" when there is no approved target or the target is 0.

## 6. Reports

Report Center → Sales & Marketing: **Target Attainment** and **Sales Credit Register**.

## 7. Good practice

- Keep reporting lines (employee → manager) up to date. Team figures follow today's reporting tree.
- Fix wrong credit on an order **right away** (with a reason), before commission statements are submitted.
- Use **pace** mid-month: it shows who is behind while there is still time to act.
