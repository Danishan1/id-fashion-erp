---
name: payment-request-excel-upload
description: Plan for Expenditure → Upload Expense Other Than Salary — downloadable Excel format sheet, upload, row-by-row validation preview with errors, then bulk-create payment requests (vouchers / advance / tax-invoice-lite) in one batch.
---

# Upload Expense Other Than Salary (Excel bulk)

Part of `accounts-payment-requests-plan`. Depends on: foundation, payee-master, voucher-single (default type).

## Template (download)
`GET /api/v1/payment-requests/upload-template` → `.xlsx` built with `src/lib/xlsx.ts`. Sheet "Requests" columns:
Request Type (VOUCHER_SINGLE / ADVANCE_REMINDER / INVESTMENT — tax invoice excluded in v1, needs lines),
Pay To Name, Pay To Code (supplier/payee code, optional), Amount, Purpose Code, Beneficiary, Payment Due Date
(DD-MM-YYYY), Mode of Transfer, Remark. Second sheet "Help": allowed values (purpose codes, types, modes) +
one example row. Lock header row.

## Upload flow
1. Upload (`xlsx-read.ts`), max 500 rows, max 5 MB.
2. Validate every row (same Zod schema as the single form — one source) → preview table: OK / error per cell,
   resolved pay-to, totals. Nothing saved yet (or store `ImportBatch` row like Bulk Import does).
3. "Create N requests" → creates only valid rows in one transaction per row (idempotency key
   `upload:<batchId>:<row>`), returns created/failed list; file kept as attachment on the batch.
Partial success allowed; errors downloadable as `.xlsx`.

## Validation per row
type allowed, amount 2 dp > 0, pay-to resolves or free-text allowed for the type, purpose code exists & active,
date valid (not past by > 365 days?), duplicates inside the file (same pay-to+amount+date) warned.

## RBAC
`payment_requests.create`; every created request follows normal routing (approval etc.).

## Reuse
`CsvImportModal.tsx` UX, `src/modules/import/bulk-import.service.ts` ImportBatch pattern, `sanitizeSpreadsheetCell` (bulk-actions module) on export of errors.

## Tests
template columns stable; bad rows rejected with exact messages; re-upload same batch idempotent; 500-row cap.

## Done checklist
- [ ] template download
- [ ] parse + preview
- [ ] create batch + error export
- [ ] tests
