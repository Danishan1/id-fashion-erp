/**
 * Side-effect-only barrel, client-safe (zero Prisma imports anywhere in this
 * chain) — importing this file registers every built report's page metadata
 * (title/filters/link-builders) into report-page-meta.ts's registry. Imported
 * by the generic report detail page.
 */
import "./page-meta/sales-orders.page-meta";
import "./page-meta/purchase.page-meta";
import "./page-meta/suppliers.page-meta";
import "./page-meta/sampling.page-meta";
import "./page-meta/inventory.page-meta";
import "./page-meta/production.page-meta";
import "./page-meta/quality.page-meta";
import "./page-meta/packing-dispatch.page-meta";
import "./page-meta/accounts.page-meta";
import "./page-meta/invoicing.page-meta";
import "./page-meta/receivables-payables-expenses.page-meta";
import "./page-meta/profitability.page-meta";
import "./page-meta/customers-products.page-meta";
import "./page-meta/hr-attendance.page-meta";
import "./page-meta/audit.page-meta";
import "./page-meta/dashboard.page-meta";
import "./page-meta/warehouse.page-meta";
import "./page-meta/production-planning.page-meta";
import "./page-meta/material-consumption.page-meta";
import "./page-meta/business-performance.page-meta";
