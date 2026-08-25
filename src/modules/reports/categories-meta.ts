import type { ReportCategory } from "@/core/reports/permissions";

export interface ReportCategoryMeta {
  key: ReportCategory;
  label: string;
  description: string;
  /** Set when the WHOLE category has no real data source at all (a hard schema gap) — shown instead of "not yet built". */
  unavailableReason?: string;
}

export const REPORT_CATEGORIES_META: ReportCategoryMeta[] = [
  { key: "dashboard", label: "Executive Dashboard", description: "Company-wide KPI snapshot across every module." },
  { key: "mis", label: "Management MIS", description: "Daily management information summary." },
  { key: "sales-orders", label: "Sales & Orders", description: "Order register, sales register, customer-wise sales, pending & aging orders." },
  { key: "purchase", label: "Purchase", description: "Purchase order register, pending POs, supplier-wise purchase, monthly summary." },
  { key: "suppliers", label: "Suppliers", description: "Supplier register and outstanding (AP aging)." },
  { key: "sampling", label: "Sampling", description: "Sample register, status, and conversion-rate reports." },
  { key: "sampling-raw-material", label: "Sampling Raw Material", description: "Material requirement per sample version." },
  { key: "inventory", label: "Inventory / Stores", description: "Stock summary, ledger, low/negative stock, valuation." },
  { key: "warehouse", label: "Warehouse", description: "Warehouse-wise stock reporting." },
  { key: "production", label: "Production", description: "Production register, pending, achievement %, rejection %." },
  { key: "production-planning", label: "Production Planning", description: "Planned vs. actual (folded into Production's own reports)." },
  { key: "material-consumption", label: "Material Consumption", description: "BOM-driven consumption vs. plan." },
  { key: "quality", label: "Quality / QC", description: "QC inspection register and defect analysis." },
  { key: "packing", label: "Packing", description: "Carton summary and color/size packing composition." },
  { key: "dispatch", label: "Dispatch", description: "Dispatch register, pending dispatch, customer-wise dispatch." },
  { key: "invoicing", label: "Invoicing", description: "Sales invoice register and outstanding invoices." },
  { key: "accounts", label: "Accounts / Finance", description: "Trial balance, general ledger, day book, journal register." },
  { key: "receivables", label: "Receivables", description: "Customer outstanding / AR aging, customer ledger." },
  { key: "payables", label: "Payables", description: "Supplier outstanding / AP aging, payments made." },
  { key: "expenses", label: "Expenses", description: "Expense register by account/category." },
  { key: "profitability", label: "Profitability", description: "Order and style profitability (revenue vs. tracked cost)." },
  { key: "customers", label: "Customers", description: "Customer register and outstanding." },
  { key: "products", label: "Product / Style", description: "Style register and style-wise production." },
  { key: "hr", label: "HR", description: "Employee register and department-wise headcount." },
  { key: "attendance", label: "Attendance", description: "Daily attendance and monthly summary." },
  {
    key: "payroll",
    label: "Payroll",
    description: "Salary and payroll reporting.",
    unavailableReason: "Not available — no payroll module exists in this ERP (no Payroll/Salary schema). Build the Payroll module first.",
  },
  { key: "audit", label: "User / Audit", description: "User activity log and last-login per user." },
  { key: "business-performance", label: "Business Performance", description: "Cross-functional performance summary (see Executive Dashboard)." },
];
