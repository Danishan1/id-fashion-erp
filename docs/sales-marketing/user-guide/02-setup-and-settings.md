# 02 — Setup and settings

[← Back to the overview](README.md)

Do this once, before people start quoting. Most of it is master data the ERP already has; Sales & Marketing reads it and never copies it.

## 1. Master data checklist

| Check | Why it matters | Where |
|---|---|---|
| **Company GSTIN** is a real GSTIN | Quotations decide CGST + SGST (same state) or IGST (other state) from the first two digits of the company and customer GSTINs. Without it, everything is treated as same-state. | Administration → Company |
| **Financial-year start month** | Financial quarters and years in targets, forecasts and analytics follow it | Administration → Company |
| **Customers** with GSTIN, addresses and (optionally) default currency | Quotations, Sales Orders, territories, segments | Masters → Customers |
| **Styles** with variants (colour × size) and a base unit | Quotation lines, price lists, conversion to Sales Orders | Masters → Products / Styles |
| **Units** with conversions (e.g. DZN → 12 PCS) | Quoting in dozens and ordering in pieces; price lists in another unit | Masters → Lookups → Units |
| **Tax rates** (GST 5 %, 12 % …) with effective dates | Quotations use the rate in force on the quotation date | Accounts → Tax config |
| **Employees and reporting lines** linked to user logins | "My team" in every list, team targets and team performance follow the CRM reporting tree | HRMS / CRM settings |
| **Sales Agents** (if you pay outside agents) | Agent commissions | Masters → Sales Agents |
| **Departments** | Campaign ownership | Masters |

## 2. Settings

Go to **Sales & Marketing → Settings**. You need Settings edit permission.

| Section | Setting | What it does | Typical value |
|---|---|---|---|
| Quotation approval | **Max line discount without approval (%)** | A quotation with any line discount above this needs approval before it can be issued | 10 % |
| | **Max grand total without approval (₹)** | A quotation above this total needs approval | ₹5,00,000 |
| New quotations | **Default validity (days)** | Pre-fills *valid until* on new quotations | 15–30 |
| | **Default terms & conditions** | Pre-filled into every new quotation (and printed on the PDF) | Your standard terms |
| Pricing | **Max automatic discount per line (% of list price)** | A cap on discounts from discount rules and promotions together. Blank = no cap | 15–20 % |
| Forecast | **Default win probability** for approved / issued / accepted quotations | Used in the pipeline forecast when a quotation has no linked CRM opportunity with its own probability | 30 % / 50 % / 90 % |
| | **Trend: periods averaged** | How many past periods the trend forecast averages | 3 |
| | **Flag opportunities not updated for (days)** | Opportunities older than this are flagged as stale in the forecast | 60 |
| Campaigns | **Campaigns need approval** | When off, submitting a campaign approves it at once (recorded as auto-approved) | On |
| | **Warn when a campaign budget is this % used** | Raises a budget warning alert | 80 % |

Campaign types, objectives and spend categories are kept under **Campaigns → Settings** (§5).

## 3. Sales channels

**Sales & Marketing → Sales Channels.** These are the routes sales come through, for example *Export buyers*, *Domestic wholesale*, *Online*, *Agents*. Give each one a code, a name and optionally a manager.

- The channel is set on the enquiry. It carries forward to the quotation and then the Sales Order. The order's channel is the one that counts in reports and commissions.
- You can change it on any of the three records from the **Channel & sales agent** panel. A change on an order needs a reason.
- Deactivate a channel you no longer use instead of deleting it: old orders keep pointing at it.

## 4. Territories

Territories are covered in [06 Targets, territories & performance](06-targets-territories-performance.md). Create them before setting territory targets.

## 5. Campaign lists

**Campaigns → Settings** holds the campaign **types** (trade show, email, social, sampling…), **objectives** (awareness, leads, orders…) and budget **spend categories**. Default lists are created automatically the first time; rename them, add your own, or deactivate the ones you don't need.

## 6. After setup

- Ask a sales manager to create the first **price list** ([05](05-pricing-and-discounts.md)) and the period's **targets** ([06](06-targets-territories-performance.md)).
- Decide which **workflows** to switch on ([17](17-workflows.md)).
- If you will send campaign messages, set up **Channel Connections** ([12](12-sending-campaign-messages.md)).
