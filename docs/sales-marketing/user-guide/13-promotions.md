# 13 — Promotions

[← Back to the overview](README.md)

A promotion is a price offer applied to quotation lines: either **automatically** or when the buyer gives a **code**. Promotions work through the same pricing engine as discount rules ([05](05-pricing-and-discounts.md)), so every discount is explained on the line.

## 1. Creating a promotion

**Sales & Marketing → Promotions → New.**

- **Applies:** *Automatic*, or *With a code* (enter the code).
- **Discount:** % off, or ₹ off per unit; exclusive or stackable, with a priority.
- **Who and what** (all optional; all that are set must match):
  - styles, categories and excluded styles;
  - price list;
  - customers, sales channels, campaigns;
  - members of a segment snapshot.

  Prospects never qualify for customer or segment promotions.
- **Minimums:** minimum quantity (in base units) and minimum line value.
- **Dates:** valid from / to, compared with the **quotation date**.
- **Limits:** total uses and uses per customer.

## 2. Approval and switching on

1. **Submit** the version for approval. Someone else approves it.
2. **Switch on** the promotion; this needs approve permission. A promotion prices nothing until it has an approved version **and** is switched on.
3. The display status is shown automatically: *Scheduled* (before the start date), *Running*, or *Expired* (after the end date).
4. To change approved terms, start a **new version** and have it approved. **Pause** or **archive** stops new prices. Issued quotations always keep theirs.

## 3. On a quotation

- Automatic promotions apply on their own whenever they match.
- For a code promotion, enter the code on the quotation. Codes that don't exist or don't apply are reported, and a quotation can't be saved with an unusable code.
- Promotions and discount rules compete: the best exclusive discount or all stackable ones together, whichever is bigger, within the cap in Settings.

## 4. How uses are counted

| What happens | Use |
|---|---|
| Quotation issued | **Reserved** until its valid-until date |
| Customer accepts | Still reserved, no longer expires |
| Converted to a Sales Order | **Redeemed** |
| Quotation rejected, cancelled or revised; validity passed; order cancelled | **Released** (given back) |

Limits count redeemed and reserved uses. Two quotations issued at the same moment can never exceed a limit: the second one is refused with a clear message.

## 5. Good practice

- Tie promotions to a **campaign**: the campaign's results and ROI then show what the promotion brought.
- Use **per-customer limits** for introductory offers.
- Use the **Pause** bulk action to stop several promotions at once at the end of a season.
