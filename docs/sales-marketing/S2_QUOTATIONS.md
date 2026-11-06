# Sales & Marketing — Release 1 / S2 Quotations core (2026-10-28)

Spec: `ref/02.md` §6.1–6.3, §7.4–7.6, §9. Plan: `RELEASE_PLAN.md` (S2). Decisions used: D4 (line kinds) and, asked 2026-10-28 before building:
- **Own permission module** `sales_quotations` (in the SALES_MARKETING package).
- **Prospects allowed**; converting to a Sales Order (S4) will need a real Customer.
- **GST split**: CGST + SGST for intra-state, IGST for inter-state.

## 1. What exists after S2

| Area | Result |
|---|---|
| Data | `quotations` (number, enquiry, customer or prospect, CRM company/contact, owner, status) → `quotation_revisions` (all commercial content + totals, one row per revision) → `quotation_lines`. Revision 1 is created as a DRAFT and edited in place. S3 freezes a revision on issue and adds new revisions for later changes. |
| Numbering | `QUO-YYYY-#####`, company-wide (`branchId: null`). New `DocumentType.QUOTATION`. |
| Lines (D4) | Style, approved Design (Sample Request with status APPROVED; its Style is taken when it has one) or a new item (free text). Free text is flagged "needs a Style before conversion". Qty (3 dp), unit, unit price, discount %, GST rate, delivery date, colour/size wording, customer reference. The exact colour × size split is entered on the Sales Order at conversion (S4) — the Sales Order form already does that. |
| Charges | Freight and one "other charges" amount, each with its own GST rate. |
| GST | Rate from the Tax Rate master, effective on the quotation date, frozen on the line. Company state = first 2 digits of the company GSTIN; place of supply defaults from the customer GSTIN and can be changed. Different = IGST, same or unknown = CGST + SGST (existing ERP rule, `isInterStateSupply`). |
| Calculation | `src/modules/sales-marketing/quotations/quotation-calc.ts` (pure, shared by the editor preview and the server; reuses the ERP's `calculatePayableLine`). Per line: gross = qty × price → discount → taxable → GST → CGST = round(GST/2), SGST = rest; totals are sums of rounded values; half-up to the paisa. The server never stores a total sent by a client (payloads are strict). |
| Enquiry link | "Create quotation" on the enquiry pre-fills party, CRM links, owner, title, addresses, payment terms and one line per non-rejected enquiry line. The party of an enquiry quotation always comes from the enquiry. Creating one moves the enquiry NEW / UNDER_REVIEW / QUALIFIED → QUOTATION_IN_PROGRESS; cancelling its last open quotation moves it back to QUALIFIED (both in the same transaction, both on the enquiry timeline). On-hold, closed or cancelled enquiries can't be quoted. |
| Lifecycle in S2 | DRAFT → edit (optimistic `version`, 409 on a stale save) → Cancel (reason). Everything else (approval, issue, PDF, revisions, accept/reject, expiry) is S3; convert is S4. |
| Access | `sales_quotations`: MANAGEMENT view / view_all / approve / reject / export / print; MERCHANDISER view / create / edit / cancel / export / print; VIEWER view; custom roles and user overrides copied from `sales_marketing`. Visibility = CRM rule (own / CRM team / unassigned-created; view_all = all). Quotations are company-wide (no branch). |
| Screens | `/sales-marketing/quotations` (list: open/closed/all, status, owner, search, sort), `/new` (standalone or `?enquiryId=`), `/[id]` (details, lines with GST, totals, revisions, attachments, cancel), `/[id]/edit`. Enquiry page: Quotations section + "Create quotation". Sidebar leaf "Quotations". A user with only quotation access lands on the quotations list. |
| API | `/api/v1/sales-marketing/quotations` (GET, POST), `/[id]` (GET, PUT draft), `/[id]/cancel`, `/options?date=` (effective GST rates, units, company GST state, owners), `/prefill?enquiryId=`. |
| Attachments | `QUOTATION` record-attachments target (company-wide, same visibility). |

## 2. Database

Migration `20261028270000_sales_quotations_s2`: 3 enums, 3 tables with CHECKs (customer or prospect; valid-until ≥ date; qty > 0, price ≥ 0, discount 0–100), `DocumentType`/`RelatedModule` value `QUOTATION`, 13 `sales_quotations.*` permissions with grants as above.
Rollback `prisma/rollback/20261028270000_sales_quotations_s2.down.sql`: deletes all quotations, their attachment/notification rows (files on disk stay) and sequences, the tables, enums and permissions. The `QUOTATION` enum values stay (Postgres can't drop them; unused).
Deploy: back up → `prisma migrate deploy` → `scripts/sync-permission-catalog.mjs` (adds nothing new) → restart app and worker.

## 3. Acceptance criteria

1. A quotation can be made from an enquiry (pre-filled) or standalone, for a customer or a prospect, with Style / Design / new-item lines.
2. All amounts are computed on the server with one documented rule; CGST/SGST vs IGST follows the states; client totals are never stored.
3. GST rates must be active on the quotation date; designs must be approved; styles must be styles; enquiry lines must belong to the enquiry.
4. Drafts save with version checks; cancel needs a reason; the enquiry stage follows (in progress / back to qualified).
5. Access via `sales_quotations` with own/team/all visibility, also for attachments.
6. Tests, type check, lint and build pass.

## 4. Verification (cloud sandbox, Postgres 16)

- Migration on the S1 database; grants per role checked by query; rollback leaves only the two unused enum values; re-apply clean.
- `quotation.integration.test.ts` (real DB, 7 tests): IGST draft totals to the paisa incl. freight GST and a design line; CGST/SGST split; prospect; every reference rule; strict payload; enquiry prefill → create → stage moves → cancel back to Qualified; on-hold enquiry refused; draft versioning + line replace + owner notification; visibility incl. attachments; effective-dated GST options. S1 enquiry suite re-run: 12 passed.
- Unit / route / component: calc (rounding, odd paisa, IGST, charges, free lines), routes use `sales_quotations` actions, editor preview equals server maths and never posts totals, enquiry page section.
- Full suite 3739 passed / 237 skipped; `tsc` 0; `eslint` 0 errors (22 existing warnings); `next build` OK.
- Browser: enquiry → Create quotation → GST/freight/terms → draft (₹3,11,100.00, matches the preview) → edit qty → enquiry shows Quotation in progress → cancel → enquiry Qualified; standalone quotation for a customer with a style line. No page errors. One bug found and fixed in the browser run (a client helper called from a server page).
- Not run against the user's own database.

## 5. Known limits / follow-ups

- The sandbox company GSTIN is not a valid GSTIN, so the sandbox shows CGST + SGST everywhere; the editor warns when this happens. Set a real GSTIN on the company for IGST.
- Quotation currency is the company base currency (INR); no multi-currency (Release 1 scope).
- No colour × size grid on the quotation — captured on the Sales Order at conversion (S4).
- CRM opportunity link for quotations comes with S4 (`QUOTATION` provider in the CRM opportunity ERP links).
- Customer / style / design pickers load the first 200 records (same as the existing enquiry and order forms).
