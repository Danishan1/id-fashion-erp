---
name: payment-request-supplier-credit-note
description: Plan for Suppliers payment → Update Supplier Credit Note — supplier, credit amount, credit note no/date, against invoice no/date, attachment (PDF/JPG/PNG) and reason; a new SupplierCreditNote document that reduces payable (Dr AP / Cr expense [+ Cr GST-ITC]).
---

# Update Supplier Credit Note

Part of `accounts-payment-requests-plan`. Depends on: foundation (RBAC/UI hub), gst-invoice-lines (optional tax split).
Not a payment request (no money out) — lives in the same Suppliers tab for convenience.

## Fields (spec)
Supplier (required), Credit Amount (2 dp, > 0), Credit Note No (required, unique per supplier), Credit Note Date
(required, not future), Invoice No + Invoice Date (the original bill — picker over that supplier's posted
purchase invoices, fallback free text for bills outside the system), Attach credit note (required, PDF/JPG/PNG
only), Reason (required). Optional added: GST part of the credit (amount or %) so ITC is reversed correctly.

## Schema
`SupplierCreditNote` (companyId, branchId, number `SCN-YYYY-#####` new DocumentType, supplierId,
purchaseInvoiceId nullable, supplierCreditNoteNumber, creditNoteDate, invoiceNumber/Date text, amount,
taxAmount, reason, status DRAFT/POSTED/CANCELLED, journalId, appliedAmount, createdBy/postedBy, idempotencyKey).
`PurchaseInvoice.creditedAmount` (new) so balance = total − credited − paid; Payment allocation caps must use it.

## Flow
DRAFT → Post (`payments.approve`-equivalent; recommend `invoices.post`, self-guard) → POSTED; cancel only DRAFT.
Credit amount ≤ linked invoice's (total − credited − paid); if no linked invoice → supplier credit balance usable
by `allocatePayment`-like "apply credit" later (v2).

## Journal
Dr AP (total) / Cr original expense account(s) or COGS (taxable) / Cr GST-ITC (tax, only if ITC had been taken).

## Reuse
`custom-invoice-credit-note.service.ts` (customer-side cap/number/edit-guard patterns), AttachmentsPanel,
PurchaseInvoice outstanding queries (update them to subtract creditedAmount — check `listOutstandingInvoicesForParty`).

## Tests
cap against invoice balance; duplicate CN number refused; ITC reversal line; invoice status recompute
(PAID when total = credited + paid); reports reflect credit.

## Done checklist
- [ ] schema + DocumentType
- [ ] service/routes/UI
- [ ] outstanding/aging/AP reports subtract credits
- [ ] tests
