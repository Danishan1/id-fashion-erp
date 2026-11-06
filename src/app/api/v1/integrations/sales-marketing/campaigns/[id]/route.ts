import { smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { apiGetCampaign } from "@/modules/sales-marketing/integrations/public-api.service";

/** GET /api/v1/integrations/sales-marketing/campaigns/{id}. Scope sm.campaigns:read. */
export const GET = smApiRoute<{ id: string }>({ scope: "sm.campaigns:read", endpoint: "GET /campaigns/{id}" }, async ({ actor, params }) => ({ data: await apiGetCampaign(actor, params.id) }));
