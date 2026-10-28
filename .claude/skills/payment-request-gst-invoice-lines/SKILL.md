---
name: payment-request-gst-invoice-lines
description: Plan for the shared GST invoice-lines table used by Tax Invoice (non-supplier), Supplier Bill and Adjustment requests — Invoice No/Date, Description, Is for Stock, Purpose, HSN, hidden MRP, Rate, Qty, Taxable, CGST/SGST/IGST %+amount, Discount %/amount, Amount, totals, ITC Y/N, RCM Y/N, place of supply, raw-material flag, decimal validation and the journal impact.
---

# GST invoice lines (shared component + calculator)

Part of `accounts-payment-requests-plan`. Depends on: foundation, payee-master. Used by:
`payment-request-tax-invoice`, `payment-request-supplier-bill`, `payment-request-supplier-adjustment`.

## Header fields (on the request)
- `isItcApplicable` Y/N (default Y) · `isReverseCharge` (RCM) Y/N (default N)
- `placeOfSupplyStateCode` dropdown from `GST_STATE_CODES` (default = company state)
- `payToGstin` read-only, fetched from Supplier.taxRegistrationNo / Payee.gstin; editable override with format check
- `isRawMaterialForProduction` Y/N · `paymentDueDate` · `modeOfTransfer`
- Invoice table: `invoiceNumber`, `invoiceDate` — **one invoice per request** (user decision 2026-10-27);
  stored on the request header, lines in `PaymentRequestInvoiceLine`

## Line fields (`PaymentRequestInvoiceLine`)
description (req), isForStock (bool), purposeId (→ ExpensePurpose, gives GL account), productId (optional, only
if isForStock — raw material picker), hsnCode (4/6/8 digits), mrp (hidden column, optional), rate, quantity,
taxableAmount = rate×qty − discount (**calculated**), discountPercentage / discountAmount (one drives the
other), gstRate % (from TaxRate), cgstPercent/cgstAmount, sgstPercent/sgstAmount, igstPercent/igstAmount,
lineAmount = taxable + GST.

## Calculation rules (server is source of truth; client only previews)
- Intra-state (place of supply = company state) → CGST = SGST = gst/2; inter-state → IGST = gst.
  Reuse `calculateLineGst` / `calculateInvoiceGst` from `src/lib/gst.ts`.
- RCM = Y → tax computed but **not paid to the party**: Grand Total payable = taxable only.
- Totals: Total (taxable), Total GST, Total Discount (hidden), Grand Total. Round each line to 2 dp, totals =
  sum of rounded lines (`round2` from `src/lib/money.ts`).
- Decimal validation: money ≤ 2 dp, qty ≤ 4 dp, % ≤ 2 dp, % between 0–100, rate ≥ 0, qty > 0.
- Never trust client totals (Sales Order / Journal precedent).

## Journal (built at payout by the owning skill, documented here once)
- ITC=Y, RCM=N: Dr line accounts (taxable) + Dr GST-ITC (GST) / Cr party-or-EXP-PAY (grand total)
- ITC=N: Dr line accounts (taxable + GST — GST becomes cost) / Cr payable
- RCM=Y, ITC=Y: Dr line accounts (taxable) + Dr GST-ITC (GST) / Cr GST-RCM-PAY (GST) / Cr payable (taxable)
- RCM=Y, ITC=N: Dr line accounts (taxable + GST) / Cr GST-RCM-PAY (GST) / Cr payable (taxable)
- isForStock lines with productId: optional later step — raise a Goods Receipt? **Not in v1**; record only and
  show on a "stock purchases outside PO" report. Flag to user.
- Consider storing CGST/SGST/IGST separately in GL later (GST-ITC-CGST etc.) — v1 single GST-ITC.

## UI component
`src/components/accounts/GstInvoiceLinesEditor.tsx` (client-safe calc helper in `src/lib/payables-gst.ts`),
add/remove rows, live totals, MRP column hidden by default, discount % ↔ amount sync.

## Tests (pure calc file, many cases)
intra vs inter state split; RCM payable excludes GST; ITC=N folds GST into cost; discount % vs amount;
rounding sums; invalid decimals rejected; place of supply missing → company state.

## Done checklist (built 2026-10-28)
- [x] calc helper + tests — `src/lib/payables-gst.ts` (own calculator, not calculateLineGst: that one zeroes
      tax under RCM, right for sales but wrong for bills we pay)
- [x] schema — migration `20261028130000_payment_request_invoice_lines` (+ rollback): invoice header columns on
      payment_requests + `payment_request_invoice_lines` (each line has its own expenseAccountId, filled from the purpose)
- [x] Zod schema shared by 3 request types — `payment-requests/gst-invoice.schema.ts`
- [x] `computeGstInvoice()` (server recompute) + `buildGstInvoiceJournalLines()` + tests — `payment-requests/gst-invoice.ts`
- [x] editor component — `src/components/accounts/GstInvoiceLinesEditor.tsx` (+ `toGstInvoicePayload`)

As built:
- Place of supply empty = our state, read from the company GSTIN (Company has no state column). No GSTIN =
  intra-state (CGST + SGST).
- GST rate is picked from the common slabs (0, 0.25, 3, 5, 12, 18, 28): /api/v1/tax-rates needs accounts.view,
  which request raisers do not have.
- Journal builder takes resolved account ids; GST-RCM-PAY is created lazily by the paying skill
  (`GST_CONTROL_ACCOUNTS`, same as SUP-ADV). Single GST-ITC account (no CGST/SGST split in the GL yet).
- Not wired into any form yet: Tax Invoice / Supplier Bill / Adjustment do that. isForStock lines do not raise
  a Goods Receipt (v1, as planned).
