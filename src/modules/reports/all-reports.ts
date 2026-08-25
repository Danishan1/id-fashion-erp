/**
 * Side-effect-only barrel — importing this file registers every built
 * report's descriptor-builder into the server-side registry (registry.ts).
 * Imported by both API route handlers. Add one line here per new category
 * report file.
 */
import "./sales-orders.reports";
import "./purchase.reports";
import "./suppliers.reports";
import "./sampling.reports";
import "./inventory.reports";
import "./production.reports";
import "./quality.reports";
import "./packing-dispatch.reports";
import "./accounts.reports";
import "./invoicing.reports";
import "./receivables-payables-expenses.reports";
import "./profitability.reports";
import "./customers-products.reports";
import "./hr-attendance.reports";
import "./audit.reports";
import "./dashboard.reports";
