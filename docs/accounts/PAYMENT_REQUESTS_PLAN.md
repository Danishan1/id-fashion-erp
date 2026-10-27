# Accounts → Expenses → "Payments Request" — audit, gap analysis, plan

Status: **planning only** (2026-10-27). No `src/` or `prisma/` change yet.
Every plan item has its own skill in `.claude/skills/` — start from
`.claude/skills/accounts-payment-requests-plan/SKILL.md` (build order + dependencies).

---

## 1. What exists today (audit)

All Accounts code lives in `src/modules/accounts/`, pages in `src/app/(dashboard)/accounts/`,
APIs in `src/app/api/v1/<doc>/`. Sidebar has one entry "Accounts" (`navigation.ts:221`)
that opens a card hub (`accounts/page.tsx`). Every posting goes through
`postJournalCore()` (`journal.service.ts`); document-sourced journals can't be reversed.

| Area | Model / files | Flow today | Journal |
|---|---|---|---|
| **Expenses** | `Expense`, `ExpensePayment`; `expense.service.ts`; pages `accounts/expenses/*` (list, new, edit, upload-bill, detail panel) | `PENDING_APPROVAL` → Approve (`expenses.approve`, self-guard) / Reject (reason, terminal) → Pay (`expenses.post`, self-guard) one or many times → `PARTIALLY_PAID` → `PAID`; Cancel before payment. "Upload Bill" (`source=BILL_UPLOAD`) = amount + files, accountant fills account/tax before approving. TDS % on base amount. Single expense line (one account, one tax rate). | 1st payment posts accrual: Dr expense [+ Dr GST-ITC] / Cr TDS-PAY / Cr EXP-PAY. Each payment: Dr EXP-PAY / Cr CASH-or-BANK (by `PaymentType.type`). |
| **Attachments + voice notes** | `AttachmentsPanel.tsx`, `VoiceRecorder.tsx`, `/api/v1/record-attachments/[module]/[recordId]`, `FileStorage` allows `audio/*` | Already works on EXPENSE, EXPENSE_PAYMENT, EMPLOYEE_ADVANCE, EMPLOYEE_ADVANCE_SETTLEMENT, INTERNAL_TRANSFER | — |
| **Employee Advance (imprest)** | `EmployeeAdvance` + `EmployeeAdvanceSettlement` | DRAFT → Issue (Dr EMP-ADV / Cr cash-bank) → settlements (Dr expense [+ITC] / Cr EMP-ADV) → PARTIALLY_SETTLED → SETTLED. Pay-to must be an `Employee`. No approval step. | yes |
| **Internal Transfer** | `InternalTransfer` | DRAFT → Post (`accounts.post`, self-guard) → POSTED; Cancel from DRAFT. From/To = PaymentType (+ optional BankAccount). | Dr to-control / Cr from-control. **Only two control accounts exist (CASH, BANK)**, so bank-A→bank-B is refused as a no-op. |
| **Payments** | `Payment` + `PaymentAllocation` | RECEIPT / PAYMENT_OUT, DRAFT → Post (`payments.approve`) → POSTED; allocations optional (**on-account**), `allocatePayment()` later (no new journal). | PAYMENT_OUT: Dr AP / Cr cash-bank |
| **Purchase Invoices** | `PurchaseInvoice` + `PurchaseInvoiceItem` | PO-backed lines and/or **direct lines** (description + expense account), DRAFT → Post → PARTIALLY_PAID → PAID via Payment allocations. One `TaxRate` per line (GST % only, **no CGST/SGST/IGST split, no RCM, no place of supply, no ITC flag**). | Dr COGS / Dr <direct accounts> / Dr GST-ITC / Cr AP |
| **Sales / Custom Invoices + credit notes** | `custom-invoice*.ts` has CGST/SGST/IGST, `placeOfSupplyStateCode`, `isReverseCharge`, discount %, credit notes (overall / product-wise / return) | Customer side only | Custom Invoice stays outside the ledger |
| **GST helpers** | `src/lib/gst.ts`: `GST_STATE_CODES`, `extractStateCodeFromGstin`, `calculateInvoiceGst`, `calculateLineGst` | used by Custom Invoice | — |
| **Chart of Accounts** | `ChartOfAccount` (parent/child), seeded control accounts CASH, BANK, AR, AP, GST-ITC, GST-PAY, EXP-PAY, TDS-PAY, EMP-ADV, COGS, EXP-* | Expense picker = active non-COGS EXPENSE accounts | — |
| **Tax config** | `TaxType` / `TaxRate` (effective-dated) | GST 5/12/18 % | — |
| **Bank Accounts / Payment Types** | `BankAccount` (name/bank/no/IFSC/UPI, **no kind, no ledger account**), `PaymentType` (CASH/BANK/CHEQUE/CARD/UPI/OTHER) | Masters → Finance Config | — |
| **Supplier** | `Supplier.taxRegistrationNo` (GSTIN), no state field | GST state is derivable from GSTIN digits 1–2 | — |
| **HRMS Salary Sheet** | `attendance-team.service.ts` `getSalarySheet()` / `finaliseSalaryMonth()` → `AttendanceMonthClose.snapshotJson.rows[]` (`SalaryRow.netPay`, gross, deductions, OT) | Month finalised once, snapshot frozen | **No accounting / no payout link at all** |
| **Excel** | `src/lib/xlsx.ts` (write), `src/lib/xlsx-read.ts` (read), `CsvImportModal.tsx` | used by other imports | — |
| **RBAC** | `src/config/rbac.ts` modules `accounts`, `invoices`, `payments`, `expenses`, `financial_reports`; ACCOUNTS_MANAGER expenses = view/create/edit/approve/reject/post/cancel; ACCOUNTS_EXECUTIVE = view/create/edit; MANAGEMENT expenses = view/approve/reject | | |

## 2. Gap analysis per requested request type

Legend: ✅ exists · ♻️ reuse with changes · ❌ missing

| # | Request | Exists / reuse | Missing |
|---|---|---|---|
| — | Common: voice remark + remark on every request, file upload | ✅ VoiceRecorder, AttachmentsPanel, audio in FileStorage | ❌ one request hub with a request type, unified pay queue, "remark" field everywhere, due date everywhere, per-type approval routing |
| a | Salary Request (bulk from salary module, direct to accountant) | ♻️ `finaliseSalaryMonth` snapshot `netPay` | ❌ Salaries Payable account + accrual journal, bulk request creation, no-approver routing, single create, per-employee bank details on payout, partial pay per employee |
| b1 | Advance Payment (reminder) | ♻️ Expense approve→pay, attachments | ❌ "Advance paid" asset account + later adjustment against the invoice when it comes; Yes/No invoice toggle with conditional required upload |
| b2 | Investment Payment | ♻️ Expense flow | ❌ Investments asset account(s), "investment pay-to" master/free text |
| b3 | Tax Invoice (non-supplier) | ♻️ Expense + `src/lib/gst.ts` + Custom Invoice line UI ideas | ❌ multi-line invoice table on the payables side, CGST/SGST/IGST split, ITC Y/N (ITC=No → GST goes into cost), RCM (Cr GST-RCM payable / Dr GST-ITC), place of supply, GSTIN fetched from pay-to, "is for stock" + purpose + HSN, discount, raw-material-for-production flag, mode of transfer |
| b4 | Voucher Single Purpose | ♻️ Expense | ❌ purpose master, beneficiary ≠ pay-to |
| b5 | Voucher Multiple Purpose | ♻️ Expense | ❌ multi-line purpose/amount table, receipt Y/N |
| b6 | Upload expense other than salary (Excel) | ♻️ `xlsx-read.ts`, `CsvImportModal`, Bulk Import patterns | ❌ template download, row validation report, bulk create of requests |
| c1 | Supplier payment on account | ✅ Payment with zero allocations | ❌ request + approval before the Payment is made; Supplier Advance visibility (today on-account posts Dr AP → AP debit balance) |
| c2 | Payment against supplier bill | ♻️ Purchase Invoice direct bills + Payment allocation | ❌ request form that creates a posted Purchase Invoice and pays it, GST split/RCM/ITC/place of supply on purchase invoice items, document preview, raw-material flag |
| c3 | Adjustment against payment on account | ✅ `allocatePayment()` (no new journal) | ❌ request wrapper that creates the bill and allocates an existing unallocated payment (no cash moves) |
| c4 | Supplier credit note | ❌ (only customer credit notes exist) | ❌ `SupplierCreditNote` doc: Dr AP / Cr expense-or-COGS [+ Cr GST-ITC], reduces bill balance, attachment, reason |
| d1 | Loan payment | ❌ | ❌ loan accounts (given vs repayment of borrowing — **needs user decision**), purpose sub-category master |
| d2 | Imprest payment | ✅ Employee Advance | ❌ request + approval wrapper, pay-to can only be Employee today |
| d3 | Fixed Deposit | ❌ | ❌ FD account master (asset), Dr FD / Cr bank |
| d4 | Cash payment (bank → cash withdrawal) | ✅ Internal Transfer BANK→CASH | ❌ request + approval wrapper |
| d5 | RD ("RDS") payment | ❌ | ❌ RD account master (asset) |
| d6 | Transfer between own banks | ⚠️ Internal Transfer refuses bank→bank (one BANK control account) | ❌ **per-bank ledger sub-account** (BankAccount → ChartOfAccount) |
| d7 | Credit card payment | ❌ | ❌ credit-card liability account per card, Dr card / Cr bank |

### Cross-cutting improvements recommended
1. **One hub table `PaymentRequest`** (request + approval + payout queue) with a `requestType`, common fields (amount, pay-to, due date, remark, mode of transfer, status) and type-specific child data. On payout it calls the **existing posting engines** (Expense, Payment, PurchaseInvoice, InternalTransfer, EmployeeAdvance) — no second journal engine. Keep old pages working; hub becomes the new entry point.
2. **Routing per type** (`PaymentRequestTypeSetting`): `APPROVAL_THEN_PAY` (default) or `DIRECT_TO_ACCOUNTANT` (Salary). Approver ≠ creator, payer ≠ creator (existing self-approval guard).
3. **Financial accounts**: give each `BankAccount` a `kind` (CURRENT, SAVINGS, CASH, FD, RD, CREDIT_CARD, LOAN_GIVEN, INVESTMENT) and its own ledger sub-account under BANK/CASH/etc. This fixes bank→bank transfers and gives FD/RD/card/loan real balances.
4. **GST-complete payables lines** shared by Tax Invoice, Supplier Bill and Adjustment: CGST/SGST/IGST from place of supply vs company state, ITC Y/N, RCM, HSN, discount, decimal(2) validation — reuse `src/lib/gst.ts`.
5. **Payee master** for non-supplier pay-to names (with optional GSTIN/bank details) so "GST fetched from pay-to" works for b3.
6. **Statuses**: `PENDING_APPROVAL → APPROVED → PARTIALLY_PAID → PAID`, `REJECTED` (terminal, reason), `CANCELLED`; direct types start at `APPROVED`. Due-date overdue is derived, never stored.
7. **Reports**: payment-request register, due/overdue queue, TDS register, GST input register (ITC/RCM), salary payout report.

### Decisions from the user (2026-10-27)
- Loan = money **lent** by us (asset LOAN-GIVEN). No EMI-repayment flow.
- RDS = Recurring Deposit; the accountant raises it manually every month (no auto-schedule).
- Advance (reminder): payout → "Advance to party" (ADV-PAID), adjusted when the invoice arrives.
- Salary: bulk from the salary module + single create from Payment Requests.
- Approval: a dedicated **Approval Matrix** module (who approves which type / amount, whether approver may also pay) — skill `payment-request-approval-matrix`.
- Supplier on-account → separate **Advance to Suppliers** (SUP-ADV) account; adjustment posts Dr AP / Cr SUP-ADV.
- One invoice per request.
- Imprest: employees only.
- Still open: bank bulk NEFT file for salary payout?

## 3. Skill list (build order)
See `.claude/skills/accounts-payment-requests-plan/SKILL.md`.
