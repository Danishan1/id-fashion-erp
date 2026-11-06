import { smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { smEventCatalogue } from "@/modules/sales-marketing/integrations/sm-webhooks.service";

/** GET the subscribable S&M event types (contract v1) with a synthetic sample envelope each. Scope sm.webhooks:manage. */
export const GET = smApiRoute({ scope: "sm.webhooks:manage", endpoint: "GET /webhooks/events" }, async () => ({ data: smEventCatalogue() }));
