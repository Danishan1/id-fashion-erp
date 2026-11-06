# 04 — Quotations and Sales Orders

[← Back to the overview](README.md) · Previous: [03 Enquiries](03-enquiries.md) · Next: [05 Pricing](05-pricing-and-discounts.md)

A quotation is the priced offer you send to a buyer. Each quotation has a fixed number (`QUO-YYYY-#####`) and one or more **revisions**. Once a revision is issued it is frozen; any later change is a new revision.

## 1. The life of a quotation

```
Draft ──(over a limit) submit──▶ Waiting for approval ──approve──▶ Approved ──issue──▶ Issued
  └────────────────────────── issue (within limits) ───────────────────────────────────┘
Issued ──▶ Accepted ──convert──▶ Converted (Sales Order created)
       └─▶ Rejected            Issued or Rejected ──new revision──▶ Draft (rev 2, 3 …)
Any open status ──cancel / withdraw (reason)──▶ Cancelled
```

## 2. Creating a quotation

**From an enquiry (recommended):** on the enquiry page click **Create quotation**. The customer or prospect, CRM links, owner, title, addresses, payment terms, channel, agent, campaign and one line per requested item are filled in. The enquiry moves to *Quotation in progress*.

**Standalone:** Quotations → New, for a customer or a prospect.

Fill in:

- **Lines**, each one of three kinds:
  - **Style:** an existing style;
  - **Design:** an approved sample (its style is used if it has one);
  - **New item:** free text. It needs a style before the quotation can become an order.
- For each line: quantity and unit (e.g. 10 DZN), unit price, discount %, GST rate, delivery date, colour/size wording and the customer's reference.
- **Charges:** freight and other charges, each with its own GST rate.
- **Place of supply.** It defaults from the customer's GSTIN. Same state → CGST + SGST; different state → IGST.
- Validity, introduction, delivery terms, notes, terms & conditions. **Internal notes** are never printed.

**Prices** come from the price lists automatically (see [05](05-pricing-and-discounts.md)). The line shows where the price came from, for example "List ₹100 · 100+ pcs · Customer list ABC v2 · Rules −₹5 → ₹95". If no list prices the line, type the price yourself.

**Promotions:** automatic promotions apply on their own. For a code promotion, enter the code on the quotation (see [13](13-promotions.md)).

All totals are calculated by the server: gross, discount, taxable, GST, charges, grand total, rounded to the paisa. Save the draft as often as you like.

## 3. Approval

A draft needs approval before it can be issued when:

- any line discount is above the limit in Settings;
- the grand total is above the limit;
- a price was overridden below the list price.

The page lists the reasons in plain words.

1. The preparer clicks **Submit for approval**. Approvers are notified.
2. An approver (someone other than the person who created, last edited or submitted it) opens it and clicks **Approve**, or **Decline** with a reason.
3. A declined quotation goes back to draft. Fix it and submit again.

## 4. Issuing, sending and printing

- **Issue** freezes the revision. The letterhead and party details are snapshotted, so the PDF looks the same forever. The enquiry moves to *Quoted*.
- **PDF:** download it from the quotation page. A draft prints with a "Draft — not valid for acceptance" banner.
- **Mark as sent:** record to whom, how and when you sent it. The ERP does not e-mail quotations itself; this is your record. You can repeat it.

## 5. The customer's decision

- **Accept:** decision date, method (PO, e-mail…), the customer's reference (e.g. their PO number) and a comment. Attach the PO under Attachments. An expired quotation can't be accepted.
- **Reject:** decision date and reason.
- **Expiry:** after the valid-until date an issued quotation shows **Expired**. It can't be accepted; make a new revision with new dates instead.

## 6. Revisions

Need to change an issued or rejected quotation? Click **New revision**, give a reason and edit the new draft.

- The quotation number stays the same.
- The earlier revision becomes **Superseded** and can still be opened read-only with its own PDF.
- Prices on a new revision are worked out again on its own date.

## 7. Converting to a Sales Order

On an **Accepted** quotation click **Convert to Sales Order**. You need quotation edit and Sales Order create permission.

- A **prospect** must first be linked to a real customer (**Link customer**) once it exists in Masters.
- The Sales Order form opens pre-filled and partly locked:
  - one order line per quotation line;
  - pieces converted through the unit master (10 DZN → 120 pieces);
  - unit price = taxable value ÷ pieces (after discount, before GST);
  - the customer PO number and the earliest delivery date.
- **You enter the colour × size split** for each line. It must add up exactly to the pieces.
- Pick a Style for *new item* lines, and for designs that don't have one yet.
- GST and freight/other charges are not carried: the invoice adds GST, and orders have no charge fields.

On save:

- the order is created as **Draft** (the normal Sales Order rules then apply);
- the quotation becomes **Converted** and the enquiry **Won**;
- the order page shows "From quotation QUO-… revision n".

Converting twice is impossible: a second click returns the same order.

## 8. Good practice

- Always record the decision. Accepted and rejected quotations feed the win rate, forecast, attribution and commissions.
- Use **revisions**, not new quotations, for the same deal. The history stays in one place.
- Keep an eye on **Issued quotations expiring in 7 days** on your dashboard.
- Use the **Check drafts** bulk action (Quotations → Bulk actions) before month end to see which drafts are ready to issue and which need approval.
