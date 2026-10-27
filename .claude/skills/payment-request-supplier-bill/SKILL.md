---
name: payment-request-supplier-bill
description: Plan for Suppliers payment → Payment Request Against Supplier's Bill — supplier, ITC/RCM, place of supply, fetched GSTIN, document upload with preview, raw-material flag and the GST invoice table; approval posts a direct-bill Purchase Invoice and payout pays it via an allocated Payment.
---

# Supplier — Payment Request Against Supplier's Bill

Part of `accounts-payment-requests-plan`. Depends on: foundation, gst-invoice-lines, accountant-payout.

## Fields (spec)
Amount, Supplier (registered, required), Is ITC applicable Y/N, Reverse charge (RCM) Y/N, Place of supply,
GST/VAT number (fetched from `Supplier.taxRegistrationNo`), Choose document (required — bill PDF/JPG/PNG) +
**inline preview** (`FilePreviewModal`), Is tax invoice of raw material for production Y/N, invoice table
(Invoice No, Invoice Date, Description, Is for Stock, Purpose, HSN, Rate, Qty, Taxable, CGST, SGST, IGST,
Discount, Amount; Total, Total GST, Grand Total), Payment Due Date, Mode of Transfer, Voice Remark, Remark.

## Validation
One invoice per request (user decision 2026-10-27). Amount requested ≤ Grand Total (bill is always booked for
the full Grand Total; any balance stays payable on the purchase invoice). Supplier invoice number unique per supplier
among non-cancelled purchase invoices (the existing partial unique index already enforces it — map P2002 to a
clean message). Optional link to a PO / Goods Receipt when lines are PO materials (v2).

## Ledger
- **On approval**: create a direct-bill `PurchaseInvoice` (supplierId, supplierInvoiceNumber, invoiceDate,
  direct lines: description + expenseAccountId from purpose, tax) and post it (`postPurchaseInvoiceInTx`).
  Requires extending `PurchaseInvoiceItem` with cgst/sgst/igst amounts + header `placeOfSupplyStateCode`,
  `isReverseCharge`, `isItcApplicable`, `isRawMaterialForProduction` (shared with gst-invoice-lines journal
  builder; existing PO-backed flow keeps working with defaults).
- **On payout**: Payment PAYMENT_OUT allocated to that invoice (`createPayment` + `postPaymentInTx`), Dr AP / Cr bank.
- Before paying, if the supplier has unallocated on-account money, the payout modal suggests using
  `payment-request-supplier-adjustment` instead.

## Tests
PO-backed purchase invoices unaffected; GST split journal; RCM journal (GST-RCM-PAY); duplicate supplier
invoice message; partial payouts update invoice PARTIALLY_PAID/PAID; preview shows uploaded doc.

## Done checklist
- [ ] PurchaseInvoice GST columns + journal builder reuse
- [ ] form + preview
- [ ] approval-time invoice posting
- [ ] payout allocation
- [ ] tests
