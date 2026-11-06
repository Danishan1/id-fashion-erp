# 05 — Pricing: price lists and discount rules

[← Back to the overview](README.md)

Prices on quotations come from **price lists**, and automatic discounts from **discount rules**. Both are approved by someone other than their author, so a salesperson always quotes an approved price, and every price can be explained line by line.

## 1. Price lists

**Sales & Marketing → Price Lists → New.**

1. **Header:**
   - code and name;
   - **kind**: *Default* (for everyone) or *Customer* (for one customer);
   - **priority**: when several lists apply, the higher one wins. Two active lists of the same kind can't share a priority.
2. **Version:** each list has numbered versions, each with an *effective from* date and an optional *effective to* date.
3. **Entries:** Style, unit, *from quantity*, unit price. Several entries for the same style and unit with different *from quantity* are **quantity breaks**: the highest break reached prices the **whole** quantity. For example, ₹500 from 1 PCS and ₹450 from 100 PCS → 120 PCS cost ₹450 each.
4. **Submit for approval.** Someone else approves (or declines with a reason). An approved version is **in force** from its start date. Approve a version with a future start date to schedule a price change; the current version keeps applying until then.
5. **Changing prices:** create a **new version** (a copy of the latest), edit it and approve it. Approved versions are never edited. A future version that hasn't started yet can be **withdrawn**.

Deactivating a list stops it pricing anything new. Quotations already issued keep their prices.

## 2. How a line's price is found

For a style line on a quotation, in this order:

1. A price you typed yourself (manual or override, see §5).
2. The customer's own price lists, highest priority first.
3. The default price lists, highest priority first.
4. Otherwise no price: type it by hand.

Units:

- An entry in the line's own unit wins.
- Otherwise the price is converted through the unit master (₹90 per PCS → ₹1,080 per DZN).
- A unit that can't be converted is never used.
- A quantity below the lowest break means that list doesn't price the line; the next list is tried.

## 3. Discount rules

**Sales & Marketing → Discount Rules → New.**

- **Type:** *% off* or *₹ off per unit* (per base unit, converted for other units).
- **Stacking:**
  - **Exclusive** rules: only the biggest one applies.
  - **Stackable** rules: all of them apply, one after another on the reduced price.
  - The line gets whichever gives the bigger discount: the best exclusive rule, or all stackable rules together.
- **Conditions** (all optional, all must match): style, category, customer, price list, minimum quantity, valid from / to.
- **Lifecycle:** Draft → submit → approved by someone else → **Active**. Deactivate to stop it. Only draft or inactive rules can be edited.
- Rules only apply to list prices, never to a price typed by hand.
- The optional cap in Settings limits the total automatic discount per line.

## 4. Pricing preview

**Sales & Marketing → Pricing Preview.** Pick a style, quantity, unit, customer (optional) and date. You see:

- the price and which list, version and break gave it;
- the rule discounts;
- the lists and rules that were skipped, and why (not in force, no entry, below minimum quantity, unit not convertible).

Nothing is created. Use it to answer "what would we charge for…?" and to check new lists before approval.

## 5. Prices on a quotation

| Source | When | Rules |
|---|---|---|
| **Price list (auto)** | A list prices the line | Recalculated on every draft save with the quotation's date and customer. The explanation is shown on the line |
| **Manual** | No list prices the line | You type the price |
| **Override** | A list prices the line but you type a different price | Needs *override price* permission and a reason. A price **below** the list price sends the quotation for approval. **Use list price** returns the line to auto |

Before submit or issue, the server prices the draft again. If a list or rule changed since you saved, the action is refused until you save again, so nobody issues a price they didn't see. Issued revisions keep their prices for good.

## 6. Good practice

- Keep one **default list** for standard prices and add **customer lists** only for negotiated prices.
- Use **future-dated versions** to announce price changes in advance.
- Prefer **discount rules** over manual overrides for repeat situations (volume, category, key customer). They are consistent and need no per-quote approval.
- Review overrides in the quotation register now and then. Many overrides usually mean a price list is out of date.
