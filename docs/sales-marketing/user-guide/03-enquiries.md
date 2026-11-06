# 03 — Enquiries

[← Back to the overview](README.md) · Next: [04 Quotations & orders](04-quotations-and-orders.md)

An enquiry is a buyer asking for prices, samples or a proposal. In Sales & Marketing it is the **same record** as the Merchandising buyer enquiry: Merchandising handles sampling, and Sales & Marketing adds the sales follow-up (owner, stage, follow-ups, qualification). Nothing is entered twice.

## 1. Capturing an enquiry

1. **Sales & Marketing → Enquiries → New.**
2. Choose the **customer** (and buyer), or enter a **prospect** (name, company, phone, e-mail) when the buyer isn't a customer yet. Nothing is created in Masters automatically.
3. Fill in:
   - **Enquiry date** and **source** (email, phone, exhibition, website…);
   - **Subject**, the one line your team will recognise;
   - **Owner**, the salesperson responsible (they are notified);
   - **Priority** and **Next follow-up date**;
   - **Requested items**: Style (or free text), colour, size, quantity, target price, delivery date.
4. Optional:
   - CRM company / contact (needs CRM access);
   - **Sales channel** and **sales agent** (Channel & sales agent panel);
   - **Campaign** that brought the enquiry in;
   - estimated value, expected decision date, next action, qualification notes.
5. Save. The enquiry gets an `ENQ-` number and also appears in Merchandising.

> **Tip:** owner, next follow-up date, channel and campaign drive the dashboard queue, workflows, team performance, commissions and campaign ROI. Always fill them in.

## 2. Stages

```
New → Under review → Qualified → Quotation in progress → Quoted → Won
                  ↘ Lost / Not qualified (reason required)    ↘ On hold (resume returns to the same stage)
```

- Move an enquiry through **New → Under review → Qualified** by hand. A *Qualified* stage change is what the funnel and the quotation follow-up workflow look for.
- **Quotation in progress**, **Quoted** and **Won** are set by the system, never by hand:
  - creating a quotation sets *Quotation in progress*;
  - issuing it sets *Quoted*;
  - converting the accepted quotation to a Sales Order sets *Won*.

  So an enquiry can never be "won" without the order behind it.
- **Lost** and **Not qualified** need a reason. **Reopen** (with a reason) brings the enquiry back to *Under review*. Won is final.
- **On hold** pauses the enquiry; **Resume** returns it to exactly the stage it was held from.
- An enquiry cancelled in Merchandising becomes read-only here.

## 3. Working an enquiry

The enquiry page shows the status bar and allowed actions, the details, qualification, requested items, CRM links, linked opportunities, quotations, attachments and the **timeline**.

- **Log interactions:** add notes, calls, e-mails and meetings with their time. They appear on the timeline with the author.
- **Reassign:** change the owner. The new owner is notified, and the change is logged.
- **Attachments:** the customer's tech packs, photos, mails.
- **Link a CRM opportunity** (needs CRM edit). The opportunity then lists this enquiry and its quotations.
- **Create quotation:** see [04](04-quotations-and-orders.md). The quotation is pre-filled from the enquiry.

## 4. Finding enquiries

The list has views **Open / Closed / All** and filters for stage, owner, priority, source and **Overdue** (follow-up date has passed), plus search and sorting. You see your own and your team's enquiries; with *view all*, everyone's.

## 5. Importing enquiries from Excel / CSV

**Enquiries → Import.**

1. Download the **template** (Excel or CSV). One row = one enquiry with one requested item.
2. Fill it in with customer code (or prospect fields), date, source, subject, priority, owner e-mail, follow-up date, style code, colour, size, quantity, target price and delivery.
3. Upload it (up to 5 MB, 2,000 rows). **Validate** shows every row that would fail and why. Nothing is written yet.
4. **Import.** Rows are created one by one in the background, and one bad row never stops the others. When it finishes, download the failed rows with their reasons, fix them and import again.

Rules:

- Unknown customers, styles, sizes or owners make the row fail. Nothing is created implicitly.
- A row that duplicates an existing enquiry (same customer, date, subject and style) is refused.

## 6. Bulk actions

On the list, tick enquiries (or choose *all matching the filter*) and use **Bulk actions**:

- **Assign owner** (with a dry run first);
- **Export** to Excel / CSV, which can also be saved as a schedule.

See [16 Bulk jobs](16-bulk-jobs-and-import.md).

## 7. Good practice

- Set the **next follow-up date** every time you touch an enquiry. Overdue ones show on everyone's dashboard.
- Qualify or close quickly. Old open enquiries distort the funnel and the forecast.
- Use **Lost** with an honest reason (price, delivery, quality, no response). The reasons are your best feedback.
