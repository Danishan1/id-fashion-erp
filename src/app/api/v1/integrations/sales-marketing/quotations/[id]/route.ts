import { smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { apiGetQuotation } from "@/modules/sales-marketing/integrations/public-api.service";

/** GET /api/v1/integrations/sales-marketing/quotations/{id} — current revision, lines, totals and the Sales Order (if converted). Scope sm.quotations:read. */
export const GET = smApiRoute<{ id: string }>({ scope: "sm.quotations:read", endpoint: "GET /quotations/{id}" }, async ({ actor, params }) => ({ data: await apiGetQuotation(actor, params.id) }));
