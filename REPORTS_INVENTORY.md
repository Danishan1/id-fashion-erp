# Phase 9 — Reports & MIS: Report Inventory

Branch: `report`. All reports below share the same infrastructure: `GET /api/v1/reports/<category>/<key>`
(JSON view) and `GET /api/v1/reports/<category>/<key>/export/{xlsx,csv,pdf}` (same descriptor-builder
function, guaranteeing the export can never disagree with the screen), rendered at
`/reports/<category>/<key>`. Permissions = `reports.<view|export|print>` **and** the listed owning
module's `view` permission (see `src/core/reports/permissions.ts`). PDF/Excel/CSV/Print = **Yes** for
every report below (generic infrastructure); QA Status = **Verified** for every row explicitly checked live
in the browser during this pass (noted per-row), **Built** for the rest (type-checked, unit-test-suite
green, code-reviewed, not individually browser-walked this pass).

| Report | Category | Key | DB Source | Filters | Drill-down | QA Status |
|---|---|---|---|---|---|---|
| Executive Dashboard | dashboard | executive-dashboard | SalesInvoice/SalesOrder/PurchaseOrder/StockBalance/JobOrder/Dispatch/Expense aggregates | — | — | Built |
| Management MIS — Daily | mis | daily-mis | Same sources as Executive Dashboard, scoped to one day | Date | — | Built |
| Order Register | sales-orders | order-register | SalesOrder | Customer, Status | Order → `/sales-orders/:id` | Verified |
| Sales Register | sales-orders | sales-register | SalesInvoice (POSTED) | Customer | Invoice → `/accounts/sales-invoices/:id` | Built |
| Customer-wise Sales | sales-orders | customer-wise-sales | SalesInvoice | — | — | Built |
| Pending Orders | sales-orders | pending-orders | SalesOrder | Customer | Order | Built |
| Order Aging | sales-orders | order-aging | SalesOrder | — | Order | Built |
| Order Lifecycle Report | sales-orders (bespoke) | order-lifecycle | SalesOrder + Sampling + MaterialRequest + PurchaseOrder + ProductionOrder + QcInspection + Dispatch/Carton + SalesInvoice + Payment | Order search | Sections link implicitly | Verified |
| Purchase Order Register | purchase | purchase-order-register | PurchaseOrder | Supplier | PO → `/purchase-orders/:id` | Built |
| Pending Purchase Order | purchase | pending-purchase-order | PurchaseOrderItem | Supplier | PO | Built |
| Supplier-wise Purchase | purchase | supplier-wise-purchase | PurchaseOrder | — | — | Built |
| Purchase Monthly Summary | purchase | purchase-monthly-summary | PurchaseOrder | — | — | Built |
| Supplier Register | suppliers | supplier-register | Supplier | Status | `/masters/suppliers/:id` | Built |
| Supplier Outstanding | suppliers | supplier-outstanding | PurchaseInvoice | Supplier | — | Built |
| Sample Register | sampling | sample-register | SampleRequest | Customer, Status | `/sampling/:id` | Built |
| Sample Status Report | sampling | sample-status-report | SampleRequest | — | — | Built |
| Sample Conversion Report | sampling | sample-conversion-report | SampleRequest | — | — | Built |
| Sample Material Requirement | sampling-raw-material | sample-material-requirement | SampleMaterial | Date | Sample | Built |
| Stock Summary | inventory | stock-summary | StockBalance | Warehouse | — | Built |
| Stock Ledger | inventory | stock-ledger | InventoryTransaction | Date, Warehouse | — | Verified |
| Low Stock Report | inventory | low-stock-report | StockBalance × Product.reorderLevel | — | — | Built |
| Negative Stock Report | inventory | negative-stock-report | StockBalance | — | — | Built |
| Stock Valuation | inventory | stock-valuation | StockBalance × Product.unitCost | — | — | Built |
| Production Register | production | production-register | JobOrder | Date | PO → `/production-orders/:id` | Built |
| Order-wise Production | production | order-wise-production | JobOrder | — | PO | Built |
| Production Pending | production | production-pending | JobOrder | — | PO | Built |
| Production Achievement % | production | production-achievement | JobOrder | — | PO | Built |
| Production Rejection % | production | production-rejection | JobOrder | — | PO | Built |
| QC Inspection Register | quality | qc-inspection-register | QcInspection | Date | PO | Built |
| Defect-wise Analysis | quality | defect-wise-analysis | QcDefect | Date | — | Built |
| Carton Summary | packing | carton-summary | Carton | Date | Dispatch | Built |
| Color-wise / Size-wise Packing | packing | color-size-packing | CartonItem | Date | — | Built |
| Dispatch Register | dispatch | dispatch-register | Dispatch | Date, Customer, Status | Dispatch | Built |
| Pending Dispatch | dispatch | pending-dispatch | Dispatch | — | Dispatch | Built |
| Customer-wise Dispatch | dispatch | customer-wise-dispatch | Dispatch/DispatchItem | Date | — | Built |
| Sales Invoice Register | invoicing | sales-invoice-register | SalesInvoice | Date, Customer, Status | Invoice | Built |
| Outstanding Invoice | invoicing | outstanding-invoice | SalesInvoice | Customer | Invoice | Built |
| Trial Balance | accounts | trial-balance | `getTrialBalance()` (journal.service.ts) | As Of Date | Account | Verified — reconciles exactly with `/accounts/trial-balance` |
| General Ledger | accounts | general-ledger | `getAccountLedger()` (chart-of-account.service.ts) | Account (required), Date | Journal → `/accounts/journals/:id` | Verified — Cash closing balance matches Trial Balance's Net Balance |
| Day Book | accounts | day-book | JournalLine (POSTED) | Date | Journal | Built |
| Journal Register | accounts | journal-register | Journal | Date, Status | Journal | Built |
| Customer Outstanding / AR Aging | receivables | customer-outstanding | SalesInvoice | Customer | Invoice | Built |
| Customer Ledger | receivables | customer-ledger | SalesInvoice + Payment | Customer (required), Date | — | Built |
| Supplier Outstanding / AP Aging | payables | supplier-outstanding | PurchaseInvoice | Supplier | — | Built |
| Payment Made Register | payables | payment-made-register | Payment (PAYMENT_OUT) | Date, Supplier | Payment → `/accounts/payments/:id` | Built |
| Expense Register | expenses | expense-register | Expense | Date | Expense → `/accounts/expenses/:id` | Built |
| Order Profitability | profitability | order-profitability | SalesInvoice + Bom × Product.unitCost | Date, Customer | Order | Verified |
| Style Profitability | profitability | style-profitability | Same as above, grouped by style | Date, Customer | Style | Built |
| Customer Register | customers | customer-register | Customer | Status | `/masters/customers/:id` | Built |
| Customer Outstanding | customers | customer-outstanding | SalesInvoice | — | — | Built |
| Style Register | products | style-register | Product (STYLE) | Category, Season, Status | `/masters/products/:id` | Built |
| Style-wise Production | products | style-wise-production | JobOrder | — | — | Built |
| Employee Register | hr | employee-register | Employee | Department, Status | `/masters/employees/:id` | Built |
| Department-wise Employees | hr | department-wise-employees | Employee | — | — | Built |
| Daily Attendance | attendance | daily-attendance | AttendanceRecord | Date | — | Built |
| Monthly Attendance Summary | attendance | monthly-attendance-summary | AttendanceRecord | Month | — | Built |
| User Activity | audit | user-activity | AuditLog | Date, User | — | Built |
| Last Login per User | audit | last-login-per-user | User.lastLoginAt | — | — | Built |
| Purchase Price Comparison | purchase | purchase-price-comparison | PurchaseOrderItem | Material | PO | Verified |
| Slow-Moving / Dead Stock | inventory | slow-moving-dead-stock | StockBalance + InventoryTransaction (max performedAt) | Threshold (days) | — | Verified |
| Line-wise Production | production | line-wise-production | JobOrder × ProductionLine | — | — | Verified |
| Operator-wise Production | production | operator-wise-production | JobOrderProgressEntry × Employee | — | — | Verified |
| Rework Report | quality | rework-report | ProductionStageTransaction (REWORK) | Date | PO | Verified |
| Leave Register | hr | leave-register | LeaveRequest + LeaveType | Employee, Status, Date | — | Verified |
| Profit & Loss Statement | accounts | profit-and-loss | JournalLine (POSTED, INCOME/EXPENSE) | Date | — | Verified — reconciles with Trial Balance |
| Balance Sheet | accounts | balance-sheet | `getTrialBalance()` grouped by accountType | As Of Date | — | Verified — Assets = Liabilities + Equity identity confirmed to the cent |
| Warehouse Stock Summary | warehouse | warehouse-stock-summary | StockBalance, grouped by warehouse | — | — | Verified |
| Warehouse Register | warehouse | warehouse-register | Warehouse + WarehouseLocation count | Status | — | Built |
| Production Schedule | production-planning | production-schedule | ProductionOrder (planned/actual dates) | Status | PO | Verified |
| Delayed Production Orders | production-planning | delayed-production-orders | ProductionOrder | — | PO | Verified |
| Material Consumption Variance | material-consumption | material-consumption-variance | BomItem × ProductionOrder.plannedQuantity vs. InventoryTransaction (MATERIAL_ISSUE) | — | PO | Verified |
| Consumption by Material Category | material-consumption | consumption-by-material-category | InventoryTransaction (MATERIAL_ISSUE) × Product.materialCategory | Date | — | Verified |
| Top Customers by Revenue | business-performance | top-customers-by-revenue | SalesInvoice | Date | — | Verified — matches Customer-wise Sales |
| Top Styles by Revenue | business-performance | top-styles-by-revenue | SalesInvoiceItem | Date | — | Verified — matches Style Profitability |
| Monthly Sales Trend | business-performance | monthly-sales-trend | SalesInvoice, grouped by month | — | — | Verified |

**Total: 75 reports** (74 generic + 1 bespoke Order Lifecycle) across all 26 buildable spec categories.
Only Payroll shows a "Not available" state (no schema exists in this ERP at all). Phase 9B (2026-08-25)
filled in the 4 previously "Coming soon" categories (Warehouse, Production Planning, Material Consumption,
Business Performance) and added the highest-value deferred reports from Phase 9A's own "explicitly deferred"
list (Purchase Price Comparison, Slow-Moving/Dead Stock, Line-wise/Operator-wise Production, Rework Report,
Leave Register, Profit & Loss, Balance Sheet) — see CLAUDE.md's Phase 9B section for the full build notes.
