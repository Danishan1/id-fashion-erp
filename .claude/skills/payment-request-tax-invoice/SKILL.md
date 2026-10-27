---
name: payment-request-tax-invoice
description: Plan for Expenditure → Request for Tax Invoice (Non-Supplier) — pay-to with fetched GSTIN, ITC/RCM/place of supply/raw-material flags, mode of transfer and the full GST invoice line table; becomes a multi-line Expense posted with CGST/SGST/IGST.
---

# Request for Tax Invoice (Non-Supplier)

Part of `accounts-payment-requests-plan`. Depends on: foundation, payee-master, gst-invoice-lines, accountant-payout.

## Fields (spec)
Header: Amount, Payto (Payee/free text — **not** a registered supplier; registered suppliers use
`payment-request-supplier-bill`), Is ITC applicable Y/N, Reverse charge Y/N, Place of supply (dropdown),
GST/VAT number (fetched from payto), Is tax invoice of raw material for production Y/N, Payment Due Date, Mode
of Transfer, Voice Remark, Remark, invoice file upload (recommended required — confirm).
Table: Invoice Number, Invoice Date. Items: Description, Is for Stock (checkbox), Purpose (select), HSN, MRP
(hidden), Rate, Qty, Taxable Amount (calculated), CGST %/amt, SGST %/amt, IGST %/amt, Discount %/amount,
Amount. Totals: Total, Total GST, Total Discount (hidden), Grand Total. Decimal validation.

## Extra validation
- Header **Amount must equal Grand Total** (or be derived from it — recommend auto-fill read-only, keep the
  field for parity) — mismatch refused.
- Invoice number unique per pay-to (warn) ; invoice date not future.
- Purpose required per line (gives GL account; accountant may override at approval).
- RCM=Y requires pay-to GSTIN empty or unregistered note (soft warning only).

## Ledger document
Today `Expense` is single-line. Options: (A) add `ExpenseLine` child table (account, description, hsn, taxable,
cgst/sgst/igst, itc flag) and make Expense multi-line — recommended, keeps "Expense" as the ledger doc; (B) post a
direct-bill `PurchaseInvoice` against a Payee — rejected, PurchaseInvoice requires a Supplier/AP.
Go with (A); existing single-line expenses keep working (zero lines = legacy single-account mode).

## Journal
Built by `buildGstInvoiceJournalLines()` (see gst-invoice-lines skill) at first payout (same as today's Expense
accrual: credit EXP-PAY), then Dr EXP-PAY / Cr bank per payout. TDS optional field reused from Expense.

## Routing
APPROVAL_THEN_PAY. Approver can edit purpose/account mapping only (not amounts) — or reject.

## Tests
amount = grand total enforced; ITC/RCM journals (4 combos); place-of-supply split; legacy expense untouched;
raw-material flag stored and visible in GST input report.

## Done checklist
- [ ] ExpenseLine schema + Expense service multi-line support
- [ ] form with GstInvoiceLinesEditor
- [ ] payout via Expense
- [ ] tests
