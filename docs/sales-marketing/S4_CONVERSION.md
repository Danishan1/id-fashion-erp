# Sales & Marketing — Release 1 / S4 Convert an accepted quotation to a Sales Order (2026-10-29)

Spec: `ref/04.md`, `ref/02.md` §6.11. Plan: `RELEASE_PLAN.md` (S4). Decisions D1 (enquiry = Buyer Enquiry), D4 (line types).

## 1. What happens

An **Accepted** quotation shows **Convert to Sales Order** (needs `sales_quotations.edit` and `sales_orders.create`). It opens `/sales-marketing/quotations/:id/convert`: the normal Sales Order form (no second order screen), pre-filled from the accepted revision and partly locked.

| Order field | Comes from | Editable |
|---|---|---|
| Customer / buyer | the quotation (a prospect must be linked first) | no |
| One order line per quotation line, same order | the revision's lines | no lines added / removed |
| Style | Style line: its Style. Design line: the sample's Style; if the sample has none, picked now. New-item (free text) line: picked now | only where picked now |
| Design (sample) | Design line's sample | no |
| Pieces | line quantity converted to PCS through the unit master (e.g. 10 DZN → 120) | split by colour × size; must add up exactly |
| Unit price | line taxable value ÷ pieces = after discount, before GST, to the paisa | no (server ignores the form value) |
| Line note | "QUO-… rev n line k: description" | no |
| Customer PO number | the acceptance's customer reference | yes |
| Required ship date | earliest line delivery date | yes |
| Order date | today | yes |

Not carried: GST (sales orders carry no tax — the invoice adds it) and freight / other charges (sales orders have no charge fields); the screen says so when the quotation has charges. Because the price is rounded per piece, the order total can differ from the quotation's taxable total by at most half a paisa per piece.

On save (`POST /api/v1/sales-marketing/quotations/:id/convert`) the server re-reads the revision, re-checks everything (status, customer/buyer, line order, fixed style/design, exact piece counts) and calls the existing `createSalesOrder()` — same validations, numbering, BOM snapshot, audit as any order. The order starts as **Draft**; the existing sample-approval gate applies at confirm as usual. Then, in one transaction: quotation **Accepted → Converted** (guarded write), linked enquiry → **Won** (closure reason names the order and quotation), timeline event, audit row, notification to the quotation owner. After commit, best effort: every CRM opportunity linked to the enquiry also gets the quotation and the order through the CRM's own link rules (needs `crm.edit`; a failure never undoes the order).

**Idempotent.** `sales_orders.source_quotation_revision_id` is unique. A second click, a retry or a concurrent conversion never creates a second order: whoever loses gets the existing order back, and the quotation is brought in line with it. If an order exists but the quotation is still Accepted (browser closed half-way), the convert screen offers "Mark quotation as converted".

**Blocked with a plain reason** when: not Accepted; prospect without a customer; a line unit with no conversion to PCS; a quantity that isn't a whole number of pieces (e.g. 0.1 DZN). The screen lists the reasons instead of the form.

**Prospects.** "Link customer" (on any open quotation without a customer, `sales_quotations.edit`) picks the real Customer (and optional buyer) once it exists in Masters. It only fills an empty customer — never re-points a quotation. Timeline event "Customer linked".

**Traceability.** Quotation detail shows "Converted to Sales Order ORD-… from revision n · amount · order status" (status read live). The order page shows "From quotation QUO-… revision n". The CRM opportunity's documents panel now lists quotations (the CRM's "Quotation" document type and the `QUOTATION_LINKED` stage requirement are real now, not "not available").

A converted quotation can't be cancelled or revised (S3 rules). Cancelling the order later does not reopen the quotation — make a new quotation if the business wants to quote again.

## 2. Database

Migration `20261029090000_sales_quotation_conversion_s4`: `sales_orders.source_quotation_revision_id` (nullable UUID, unique, FK → `quotation_revisions` ON DELETE SET NULL). Rollback `prisma/rollback/20261029090000_sales_quotation_conversion_s4.down.sql` (run before S3's).

## 3. Code

- `src/modules/sales-marketing/quotations/quotation-conversion.service.ts` — `getConversionPlan`, `convertQuotationToSalesOrder`, `linkQuotationCustomer`.
- `createSalesOrder(actor, input, { sourceQuotationRevisionId })` — the only change to Sales Orders' service (an optional origin argument).
- `markEnquiryWon()` in the enquiry service.
- Routes: `GET|POST /api/v1/sales-marketing/quotations/:id/convert`; action `link-customer` on the existing actions route.
- UI: `SalesOrderForm` gained a `fromQuotation` mode; convert page; quotation detail (convert button, link-customer dialog, converted banner); order page source line.
- CRM: `QUOTATION` document provider (`crm-opportunity-erp.service.ts`, registry `module: sales_quotations`), stage requirement available.

## 4. Verification (cloud sandbox, Postgres 16)

- `quotation-conversion.integration.test.ts` (real DB, 4 tests): plan — 10 DZN at ₹1,200 −10 % → 120 pieces at ₹90, design without a Style and new-item lines left to pick, PO ref and earliest delivery carried, charges flagged; conversion — wrong piece total, changed fixed Style, other customer, reordered lines all refused with nothing written; good conversion → one order line per quotation line with the quotation's price and design (form price ignored), total 120 × 90 + 30 × 333.33, quotation CONVERTED with event, enquiry WON, CRM opportunity linked to both quotation and order; second call returns the same order; two concurrent conversions → exactly one order; blockers (not accepted, prospect, 0.1 DZN = part piece; 1.5 DZN = 18 is fine); link customer (bad buyer refused, only once), then converts with buyer + PO; `sales_orders.create` denied → refused; converted quotation can't be cancelled or revised.
- Route test: convert GET → `view`, POST → `edit`, 201 new / 200 existing; `link-customer` → `edit`. Component tests: quotation detail convert button only with Sales Order permission, prospect link-customer dialog posts the pick, converted banner links the order; Sales Order form in quotation mode pre-fills/locks and posts to the convert endpoint with the line ids.
- CRM suites updated for the real Quotation document type (all pass).
- Full suite (4,005 tests): 3,995 passed, 9 skipped, 1 failed — a CRM automation integration test (`default-workflows.integration.test.ts`, untouched here) failed once under full-suite load and passed on both reruns alone — timing-sensitive, not caused by this step.
- `tsc` clean, ESLint 0 errors, `next build` OK.
- Live (production build, real browser, admin): created + issued + accepted a quotation (2 DZN Style line at ₹1,200 −10 %, 6-piece new-item line, freight) → plan 24 pcs @ ₹90 and 6 @ ₹100, PO ref and earliest delivery date carried → convert screen: split line 1 into Black M/L 12 + 12, picked a Style for line 2, a 5-piece split was refused with "add up to 5, but the accepted quotation has 6 pieces", 6 accepted → order page with "From quotation …" and the PO → quotation shows Converted with the order link, ₹2,760.00 before GST and live order status → second convert returned the same order (200), convert screen says the order already exists.
- Rollback rehearsal on a scratch copy: migrate → down script → schema identical to before.
