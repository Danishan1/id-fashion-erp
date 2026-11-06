# 08 — Channels, commissions and incentives

[← Back to the overview](README.md)

## 1. Sales channels and agents

The **channel** says which route a sale came through. The **sales agent** says which outside agent earns on it. Both are set in the **Channel & sales agent** panel on the enquiry, quotation and Sales Order:

- they carry forward enquiry → quotation → order;
- the order's values are the ones that count;
- a change on an order needs a reason and is logged.

Set up the channel list in [02 Setup](02-setup-and-settings.md) §3. Agents come from Masters → Sales Agents.

## 2. Commission plans

**Sales & Marketing → Commission Plans → New.**

| Field | Choices |
|---|---|
| Payee type | **Rep** (internal salesperson) or **Sales agent** |
| Basis | **Invoiced value**: earned when the Sales Invoice is posted, reversed if it is cancelled. **Collected value**: earned as customer payments are allocated to the invoice. Always before GST |
| Method | **Percent** of the basis, or a **fixed amount per invoice** (invoiced basis only) |
| Tiers | e.g. from ₹0 → 2 %, from ₹1,00,000 → 3 % |
| Tier mode | **All-units:** the tier reached sets the rate for the whole month. **Progressive:** each slice at its own rate |
| Minimum basis | Nothing is paid below this monthly basis |
| Cap | Maximum commission per payee per month |

Example, for a month basis of ₹1,50,000:

- all-units: ₹1,50,000 × 3 % = **₹4,500**;
- progressive: ₹1,00,000 × 2 % + ₹50,000 × 3 % = **₹3,500**.

Versions follow the same rule as everywhere: submit → approved by someone else → in force from the effective date. A change is a new version.

**Assignments:** on the plan, assign payees (reps or agents) with from / to dates. A payee is on at most one plan at a time.

**Who earns:** the order's sales rep (for rep plans) or its sales agent (for agent plans).

## 3. Incentive plans (target bonuses)

**Sales & Marketing → Incentive Plans → New.**

- Choose a metric, a period type (month, quarter or year) and **tiers** of *attainment % → fixed reward*, e.g. 100 % → ₹5,000, 120 % → ₹10,000. The highest tier reached wins.
- The plan can cover all reps with an approved target, or a chosen list.
- It needs approval. To change an approved plan, retire it and make a new one.
- The reward is added to the statement for the month in which the target period **ends**, and only once.

## 4. Monthly statements and payout

**Sales & Marketing → Commission Statements.**

1. After the month ends, **Calculate** the month. You get one statement per payee with a line per invoice or payment, plus incentive lines.
2. Review it. Add an **adjustment** (± amount with a reason) if needed. Recalculate as often as you like while it is a draft; adjustments are kept.
3. **Submit.** The lines freeze.
4. **Approve.** The approver must be someone other than whoever calculated or submitted it.
5. On approval, a **Payment Request** (type *Sales commission*) is raised automatically in **Accounts → Payment Requests**. Accounts approves and pays it there. The statement shows **Paid** when the request is paid.

Points to know:

- **Cancellations:** if an invoice or payment already paid on is cancelled later, the next statement gets a negative line for exactly the original amount.
- **Negative month:** recorded as *to recover* and carried into the next statement.
- **Late items:** an invoice dated in a month that was already submitted is picked up in the next statement, never twice.

## 5. Reports

Report Center → Sales & Marketing: **Sales by Channel** and **Commission Register**.

## 6. Good practice

- Get the **sales credit** right on orders before calculating. See [06](06-targets-territories-performance.md) §1.
- Calculate a **preview** during the month to show reps where they stand. Statements can only be submitted after the month ends.
