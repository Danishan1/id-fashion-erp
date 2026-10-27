---
name: payment-request-foundation
description: Plan for the shared Payment Request hub (Accounts → Expenses → Payments Request) — the PaymentRequest table, request types, statuses, approval routing, common fields (amount, pay-to, due date, remark, voice remark, files), numbering, RBAC and the hub UI. Use before building ANY payment request type; every other payment-request-* skill depends on it.
---

# Payment Request — foundation (build first)

Part of `accounts-payment-requests-plan`. Gap analysis: `docs/accounts/PAYMENT_REQUESTS_PLAN.md`.

## Purpose
One place where anyone raises a money-out request, an approver approves it (or it skips approval), and the
accountant pays it. The request is a *wrapper*: on payout it creates/uses the existing real documents
(Expense, Payment, PurchaseInvoice, InternalTransfer, EmployeeAdvance) — never a second journal engine.

## Request types (enum `PaymentRequestType`, group in brackets)
SALARY [SALARY] · ADVANCE_REMINDER, INVESTMENT, TAX_INVOICE, VOUCHER_SINGLE, VOUCHER_MULTIPLE [EXPENDITURE] ·
SUPPLIER_ON_ACCOUNT, SUPPLIER_BILL, SUPPLIER_ADJUSTMENT [SUPPLIER] · LOAN, IMPREST, FIXED_DEPOSIT, CASH_WITHDRAWAL,
RECURRING_DEPOSIT, BANK_TRANSFER, CREDIT_CARD [INTERNAL_TRANSFER].
(Supplier Credit Note and Excel upload are separate documents/tools, see their own skills.)
Keep a client-safe registry `src/modules/accounts/payment-requests/request-type-registry.ts`: label, group,
form component, required fields, default routing, payout handler key. New type = one registry entry.

## Common fields (every type)
- `amount` Decimal(18,2) > 0, max 2 decimals (reject 10.123, accept 10.1)
- `payToName` text (required except where a real record is picked) + optional typed link: `supplierId`,
  `employeeId`, `payeeId`, `bankAccountId` (exactly what the type allows)
- `paymentDueDate` @db.Date, optional, **default today**
- `remark` text, optional
- Voice remark: optional, stored as an `Attachment` with `contextLabel = "VOICE_REMARK"` (reuse
  `VoiceRecorder.tsx` + `/api/v1/record-attachments/[module]/[recordId]`, new `RelatedModule.PAYMENT_REQUEST`)
- Files: `AttachmentsPanel.tsx`, required/optional per type
- `modeOfTransfer` optional enum NEFT/RTGS/IMPS/UPI/CHEQUE/CASH/CARD/OTHER (where the spec lists it)
- `typeDataJson` for small type-only scalars + real child tables where lines exist
- `requestNumber` via `generateDocumentNumber` new `DocumentType.PAYMENT_REQUEST` prefix `PRQ`
- `idempotencyKey` (`@@unique([companyId, idempotencyKey])`, CF-5 pattern)
- audit: createdBy, approvedBy/At, rejectedBy/At + `rejectionReason`, paidAmount, branchId

## Schema plan (`prisma/schema.prisma`)
- `PaymentRequest` (fields above + `requestType`, `requestGroup`, `status`, `paidAmount`, `routing`
  snapshot, `sourceModule`/`sourceRecordId` for salary, links to created docs: `expenseId`, `paymentId`,
  `purchaseInvoiceId`, `internalTransferId`, `employeeAdvanceId` — all nullable, @unique where 1:1)
- `PaymentRequestStatus`: PENDING_APPROVAL, APPROVED, PARTIALLY_PAID, PAID, REJECTED, CANCELLED
- `PaymentRequestTypeSetting` (companyId, requestType, routing APPROVAL_THEN_PAY | DIRECT_TO_ACCOUNTANT,
  isEnabled, optional approvalLimit) — missing row = registry default
- `PaymentRequestPayout` (one row per payout: date, amount, paymentTypeId, bankAccountId, UTR/reference,
  journalId / linked document id) — see `payment-request-accountant-payout`
- Migration hand-written (non-interactive workaround in CLAUDE.md), additive only, plus a rollback note.

## Status flow
create → routing APPROVAL_THEN_PAY ⇒ `PENDING_APPROVAL`; DIRECT_TO_ACCOUNTANT ⇒ `APPROVED` straight away.
PENDING_APPROVAL → Approve ⇒ APPROVED | Reject (reason required) ⇒ REJECTED (terminal) | Cancel ⇒ CANCELLED.
APPROVED → Pay (part) ⇒ PARTIALLY_PAID → Pay rest ⇒ PAID. Cancel only while paidAmount = 0.
Edit only in PENDING_APPROVAL (and APPROVED for direct types, before any payout). "Overdue" = derived
(`paymentDueDate < today && status in APPROVED/PARTIALLY_PAID`), never stored.

## Who does what (RBAC)
New module `payment_requests` in `src/config/rbac.ts` (+ label in `permission-groups.ts`, catalog sync via
`scripts/sync-permission-catalog.mjs`): create/edit = requester; `approve`/`reject` = approver (self-approval
guard via `resourceContext.createdBy`); `post` = accountant pays (self-guard too); `view_all` to see others'
requests (else own only); `export`, `cancel`. Suggested grants: ACCOUNTS_MANAGER all; ACCOUNTS_EXECUTIVE
view/create/edit/post; MANAGEMENT view/view_all/approve/reject; every other role view/create (own).

## API (`src/app/api/v1/payment-requests/…`)
GET/POST `/`, GET/PATCH `/[id]`, POST `/[id]/approve`, `/[id]/reject`, `/[id]/cancel`, `/[id]/payouts`,
GET `/summary` (counts per group/status for the hub), GET/PUT `/settings` (type routing, `crm_settings`-style
admin gate → `payment_requests.approve` or `administration`).

## UI
- Rename the Accounts hub card "Expenses" → "Expenses & Payment Requests"; new page
  `/accounts/payment-requests` with 4 group tabs (Salary, Expenditure, Suppliers, Internal Transfer), each
  listing its request types as "New …" buttons; list = DataTable with filters (type, status, due, pay-to),
  "My requests", "To approve", "To pay" tabs.
- Detail page = Server page + `PaymentRequestWorkflowPanel` (key={id}), shows remark, voice player, files,
  approval history, payouts.
- Old Expense/Payment/Transfer pages stay (they are the ledger documents).

## Reuse
`expense.service.ts` (approve/reject/self-guard pattern, `expenseRemainingAmount`), `branch-access.ts`
(`branchScopeWhere` in list/get), `DocumentNumberingService`, `writeAuditLog`, `AttachmentsPanel`,
`VoiceRecorder`, `Modal`/`ConfirmModal`, global toast (`api-client.ts`).

## Tests
service tests: routing (direct type starts APPROVED), self-approval refused, reject needs reason, edit
blocked after approval, cancel blocked after payout, decimal validation, idempotency replay, branch scope
deny-as-NOT_FOUND, own-only visibility without `view_all`.

## Done checklist
- [ ] schema + migration + rollback note, verified by direct SQL
- [ ] registry + type settings with defaults
- [ ] service, routes, RBAC + catalog sync
- [ ] hub page with 4 groups, list, detail, approve/reject/cancel
- [ ] voice remark + remark + files on the common form
- [ ] tsc / eslint / vitest green; live browser check
