# 14 — Attribution and ROI

[← Back to the overview](README.md)

Attribution answers the question **"which campaigns earned this business?"** It shares the credit for each lead, enquiry, accepted quotation and booked order between the campaigns that touched that buyer before it happened. It then compares the attributed revenue with each campaign's actual spend.

## 1. What counts as a touch

| Touch | Comes from |
|---|---|
| **Message sent / delivered** | Campaign messages the provider accepted / delivered ([12](12-sending-campaign-messages.md)) |
| **Campaign response** | The campaign set on a lead, enquiry, quotation or Sales Order |

Touches reach a sale only through real record links (the contact, their company → customer, the enquiry → quotation → order chain). Nothing is matched on names, e-mails or phone numbers.

What is **not** tracked: e-mail opens and clicks, ad impressions, website visits, ad-platform costs that aren't recorded as expenses.

## 2. Models

**Attribution & ROI → Models → New.**

| Model | Credit goes to |
|---|---|
| First touch | The first campaign touch |
| Last touch | The last one before the sale |
| Linear | All touches equally |
| Position-based | First and last get a set % each (e.g. 40 / 40); the rest share the remainder |
| Time decay | Recent touches get more (set the half-life in days) |

Also set:

- the **look-back window** (1–730 days);
- which touch types and message channels count;
- which conversions count;
- whether repeated touches by the same campaign are collapsed.

Have the version **approved** by someone else, **make it the default**, then **Recalculate**. A nightly job recalculates the default model for the last 365 days.

## 3. Reading the report

**Sales & Marketing → Attribution & ROI.** Filters: model, compare with another model, revenue basis (order value, invoiced value or accepted-quote value, all before GST), period.

| Figure | Meaning |
|---|---|
| Credited conversions | Shares of leads, enquiries, accepted quotations and orders. A sale shared by two campaigns counts ½ each |
| **Attributed revenue** | Revenue credited to the campaign on the chosen basis |
| **Actual spend** | Approved expenses + posted purchase invoices linked to the campaign, dated in the period. Budgets and open POs are **not** spend |
| **ROI (revenue-based)** | (Attributed revenue − spend) ÷ spend. **This is not profit**, because product cost isn't included. "n/a" without spend |
| ROAS | Attributed revenue ÷ spend |
| Cost per lead / order | Spend ÷ credited leads / orders |
| Coverage | Share of conversions that had at least one campaign touch |

- Click a campaign to see every credited conversion, its share and the ordered touches behind it.
- **Data-quality notices** tell you when the report is **out of date** (data changed after the last calculation: click Recalculate), covers only part of the period, or has campaigns with no spend linked.

## 4. Things to keep in mind

- Attribution is credit by agreed rules, **not proof** that the campaign caused the sale.
- Approved model versions never change. A new version applies to new calculations only, so reports never mix rules.
- Report Center → Sales & Marketing has **Campaign Attribution & ROI** and **Attribution Model Comparison**, with export.

## 5. Getting reliable ROI

1. Tag leads, enquiries, quotations and orders with their campaign.
2. Link **every** campaign expense and purchase invoice to the campaign ([09](09-campaigns-and-budgets.md) §5).
3. Connect a provider that reports delivery (Brevo, WhatsApp) if you send messages.
4. Keep the default model approved, and recalculate after large data corrections.
