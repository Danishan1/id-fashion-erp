import { registerCrmBulkActions } from "@/modules/crm/bulk/crm-bulk-actions";
import { registerAnalyticsBulkActions } from "@/modules/sales-marketing/analytics/analytics-bulk";
import { registerSalesMarketingBulkActions } from "@/modules/sales-marketing/bulk/sm-bulk-actions";

/**
 * Phase 14 — every module that offers bulk actions registers here, once per
 * process (Next.js server and the worker both import this through the bulk
 * service / engine). Add a line per module; the engine needs nothing else.
 */
registerCrmBulkActions();
// Sales & Marketing Phase 14: enquiries, quotations, campaigns, promotions, attribution models.
registerSalesMarketingBulkActions();
// Sales & Marketing Phase 17: scheduled delivery of saved analytics reports.
registerAnalyticsBulkActions();
