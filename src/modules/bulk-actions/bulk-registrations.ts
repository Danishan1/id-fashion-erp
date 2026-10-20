import { registerCrmBulkActions } from "@/modules/crm/bulk/crm-bulk-actions";

/**
 * Phase 14 — every module that offers bulk actions registers here, once per
 * process (Next.js server and the worker both import this through the bulk
 * service / engine). Add a line per module; the engine needs nothing else.
 */
registerCrmBulkActions();
