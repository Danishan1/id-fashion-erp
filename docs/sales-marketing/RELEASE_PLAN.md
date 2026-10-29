# Sales & Marketing — Release Plan (first split + what to skip)

Date: 2026-10-28. Source: `docs/sales-marketing/ref/01-overview.md` … `17.md` (phase specs 02–17; there is no Phase 18 spec, so AI features are out).
Status of Phase 01 (module shell): done, see `PHASE_01_FOUNDATION.md`.

## 1. The idea

The ref specs describe 16 large phases. Built as written, each is weeks of work, and several (14–17) rebuild engines this ERP **already has**. So the plan is:

1. **Release 1 (the first split): Quote-to-Order.** Enquiry → Quotation → Sales Order, plus simple price lists. This is the part the business uses every day and everything later depends on it.
2. **Release 2: Sales performance.** Targets, territories light, commission statements on top of the existing Sales Agent commission %, pipeline forecast.
3. **Release 3: Marketing.** Campaigns, simple segments, promotions as discounts, last-touch campaign → order attribution.
4. **Release 4: Plug into existing engines.** Bulk actions, workflows, webhooks/API and reports already exist in the ERP (built for CRM) — register Sales & Marketing into them instead of building new ones. Real email/WhatsApp sending only when credentials exist.

Each slice below is one build-and-verify step (same rhythm as CRM phases). Nothing in a later slice is started before the earlier slice is accepted.

## 2. What the ERP already has (so we do NOT build it again)

| Spec phase | Already in the ERP | So in Sales & Marketing we… |
|---|---|---|
| 02 Enquiries | **Buyer Enquiries** (customer or prospect, lines with style/free-text, target qty/price/delivery, status, convert line → Sample) and **CRM Leads** | extend Buyer Enquiry into the Sales Enquiry (recommended) — see decision D1 |
| 02 Activity timeline | CRM activities/notes (CRM entities only) | add a small enquiry/quotation activity log only if D1 = new table |
| 02 PDF | `@react-pdf/renderer` + shared slip/document PDF templates | reuse |
| 02 Approvals | `PermissionService` approve action + self-approval guard; Payment Request approval matrix pattern | simple threshold rule, self-approval guarded |
| 02 Tax | `TaxRate` master (GST, effective-dated) | reuse for quotation tax display |
| 04 Orders | Sales Orders (`createSalesOrder()`), CRM opportunity ↔ ERP document links | call it; add `QUOTATION` link type to CRM |
| 05/07 Reps & commission | Sales Agents master with `commissionPercent`; Users/Employees | reuse as the rep list |
| 06 Pipeline | CRM opportunities with stages/probability | forecast reads it |
| 09 Audiences | Customers, CRM contacts/companies, contact consent (DND) | segments are filters over these |
| 10 Channels | CRM conversations + provider registry (generic webhook only), consent checks | reuse when real providers are added |
| 11 Templates | CRM message templates (versioned, variables), Attachment storage | reuse |
| 12 Budgets | Expenses / Payment Requests (real spend) | budgets reference real expenses |
| 14 Bulk | Generic bulk-action engine (`src/modules/bulk-actions/`) | register S&M actions |
| 15 Workflows | CRM workflow engine (event outbox, conditions, actions) | add S&M triggers/actions |
| 16 API/Webhooks | CRM API keys, signed outgoing webhooks, SSRF guard | add S&M events |
| 17 Reports | Report Center (75 reports, PDF/Excel/CSV export) | add S&M reports |

## 3. Release 1 — Quote-to-Order (the first split)

Goal: a salesperson records an enquiry, sends a priced, approved quotation PDF, records the customer's acceptance, and turns it into a real Sales Order with one click — fully traceable.

| Slice | Delivers | Spec source |
|---|---|---|
| **S1 Enquiries** | Sales enquiry list/detail/create (customer or prospect, CRM company/contact/opportunity link, source, owner, priority, follow-up date, requested styles with qty/target price/delivery, attachments, notes). Lifecycle: New → Under Review → Qualified → Quotation in Progress → Quoted → Won/Lost/Not Qualified, On Hold; reopen with reason. Overdue follow-ups. | 02 §5 |
| **S2 Quotations core** | Quotation (`QUO-YYYY-#####`, company-wide), lines = Style (or approved Design/Sample) or free-text item, optional colour/size breakdown, qty, UOM, unit price, line discount %, GST rate from TaxRate master, freight/other charges. Server-side decimal calculation with one documented rounding rule. Draft editing. Create from enquiry or standalone. | 02 §6.1–6.3 |
| **S3 Issue, revise, accept** | Revisions: issuing freezes a snapshot; any later change = new revision, old one Superseded. Simple approval rule (needs approval if any line discount > X% or total > Y; approver ≠ creator). PDF from the frozen revision. "Mark as sent" (manual — no email provider). Accept / Reject (reason) recorded against an exact revision by an internal user. Expiry derived from valid-until date when read. | 02 §6.4–6.10 |
| **S4 Convert to Sales Order** | Eligibility check, maps accepted revision → `createSalesOrder()` (style lines + colour/size breakdown + net unit price), idempotent (unique link, no double orders), links enquiry → quotation → revision → order, shows order status live, CRM opportunity gets the quotation and order links. | 04 (all), 02 §6.11 |
| **S5 Price lists (lite)** | Price lists: Default + customer-specific, INR, valid from/to, entries per Style (optional per variant), optional quantity breaks (all-units). Quotation lines auto-fill price with an explanation ("Customer list ABC, 100+ pcs"); salesperson can override (override above max discount → needs approval). | 03 §5–7 (subset) |
| **S6 Dashboard & reports** | Replace the "Not available yet" panel with real KPIs: open enquiries, overdue follow-ups, quotations issued / value / awaiting approval, win rate, quote-to-order conversion, top customers. 3 Report Center reports: Enquiry Register, Quotation Register, Quotation → Order Conversion. | 02 §7.7, 04 §10.4 |

**Release 1 is done when:** one real enquiry goes all the way to a confirmed Sales Order on the live DB with the full chain visible; double-click on Convert never creates two orders; an issued quotation can't be changed without a new revision; tests, lint, type check and build pass.

### Skipped in Release 1 (advanced — moved later or dropped)

| Skipped | Why / where it goes |
|---|---|
| Customer self-service / public acceptance link, e-signature | security-heavy; internal "record acceptance" is enough now |
| Email sending, delivery and "viewed" tracking | no email provider in the ERP; manual "mark as sent" + PDF download. Release 4 |
| Multi-currency quotations with exchange rates | whole ERP runs INR-only; add when multi-currency UI is done project-wide |
| Multi-level / configurable approval chains, margin-based approval | one threshold rule now; Release 4 workflow engine later |
| Customer-group, channel and regional price lists, price-list versions with approval | Release 2/3 (channels come in Release 2) |
| Graduated (progressive) tiers, min/max price constraints | all-units quantity breaks only |
| Rule-based automatic discounts, discount stacking engine, document-level discount allocation | manual line discount % only; promotions in Release 3 |
| Scheduled expiry job, notifications for expiry | expiry derived on read; reminders with workflows in Release 4 |
| Saved filters, bulk enquiry/quotation actions, CSV import | Release 4 (existing bulk engine) |
| Two-way sync of order status by events | order status is read live from the Sales Order (no copy), which is enough |

## 4. Release 2 — Sales performance

| Slice | Delivers (lite) | Skips |
|---|---|---|
| R2.1 Reps & territories | Sales rep = existing User/Sales Agent; territories = flat list (region/state) with customer assignment | hierarchical territories, territory history/re-alignment |
| R2.2 Targets | Monthly/quarterly targets per rep (and per territory) on order value and quantity; actuals from confirmed Sales Orders (and invoiced value) — never stored copies | approval workflow for targets, allocation/distribution engine, split credit |
| R2.3 Performance dashboard | Rep/territory attainment %, rankings, drill-down to orders | complex attribution rules |
| R2.4 Commission statements | Use Sales Agent `commissionPercent` (+ optional per-channel %) on invoiced/paid value; monthly statement, approve, export; payout through existing Payment Requests | tiered/accelerator plans, incentive contests, clawback engine, payroll integration |
| R2.5 Sales channels | Channel master (Export, Domestic wholesale, Retail, Online) on enquiry/quotation/order; channel report | channel hierarchy, partner portal |
| R2.6 Forecast | Weighted pipeline (CRM opportunity amount × stage probability + open quotations) vs target, by month | trend/statistical methods, scenarios, snapshots/backtesting, accuracy metrics |

## 5. Release 3 — Marketing

| Slice | Delivers (lite) | Skips |
|---|---|---|
| R3.1 Campaigns | Campaign (type, objective, owner, dates, status Draft→Active→Completed, planned budget), activities/milestones checklist, calendar view | approval & revision history, dependencies between activities |
| R3.2 Campaign links | Campaign field on CRM lead / enquiry / quotation (the old `campaign_id` link comes back properly) | — |
| R3.3 Segments | Static lists + simple dynamic filters over Customers / CRM contacts (country, type, last order date, total spend), consent/DND respected, member count + export | versioned snapshots, complex criteria builder |
| R3.4 Budget vs actual | Planned budget vs real spend from linked Expenses / Payment Requests | commitments, budget revisions/approvals, alerts |
| R3.5 Promotions | Promo = a discount rule (code, %, validity, styles/customers) applied in quotation pricing | usage limits per customer, stacking, loyalty |
| R3.6 Attribution & ROI | Last-touch: campaign → leads → enquiries → orders → revenue; ROI = revenue ÷ actual spend | multi-touch models, touchpoint normalisation, recalculation history |

## 6. Release 4 — Connect to existing engines (small, add-on work)

- Bulk actions (14): register enquiry/quotation actions (assign owner, change status, export) in the existing bulk engine.
- Workflows (15): add S&M events (enquiry created, quotation issued/accepted/expired, order created) as triggers in the CRM workflow engine; follow-up reminders.
- API & webhooks (16): add S&M events to outgoing webhooks; read API with existing API keys.
- Channels & templates (10/11): real email/WhatsApp provider through the CRM conversation provider registry once credentials are given; quotation email template via CRM templates; asset library = attachments with tags.
- Reports (17): more Report Center reports (channel, rep, campaign, conversion funnel).
- Dropped for now: AI-assisted insights (no spec), BI semantic layer / metric registry, scheduled report e-mail.

## 7. Decisions (confirmed 2026-10-28)

- **D1 — Enquiries:** extend Buyer Enquiry (owner, priority, follow-up, source, CRM links, statuses, quotation link) and show it under Sales & Marketing → Enquiries. Merchandising keeps converting lines to Samples. No second enquiry table.
- **D2 — Approval:** needed when any line discount > 10% or quotation total > ₹5,00,000; limits editable in Sales & Marketing settings; approver ≠ creator.
- **D3 — Price lists:** Release 1, as S5 — after Quote-to-Order works with manual prices.
- **D4 — Quotation lines:** Style, approved Design (Sample) or free text; free-text lines must be mapped to a real Style before conversion to a Sales Order.

Progress:
- **S1 Enquiries** — built and verified in the sandbox (2026-10-28), see `S1_ENQUIRIES.md`.
- **S2 Quotations core** — built and verified in the sandbox (2026-10-28), see `S2_QUOTATIONS.md`. Decided before building: own permission module `sales_quotations`; quotations to prospects allowed (Customer needed to convert); GST shown as CGST + SGST / IGST. Colour × size split moved to conversion (S4) — the Sales Order form already captures it.
- **S3 Issue, revise, approve, PDF, send, accept** — built and verified in the sandbox (2026-10-29), see `S3_QUOTATION_LIFECYCLE.md`. Approval limits live in the new Sales & Marketing → Settings (`sales_marketing_settings`).
- **S4 Convert to Sales Order** — built and verified in the sandbox (2026-10-29), see `S4_CONVERSION.md`. The existing Sales Order form is reused in a locked "from quotation" mode; prices are net of discount and before GST; freight/other charges aren't carried (sales orders have no charge fields).
- Next: S5 Price lists lite.
