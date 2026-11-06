import { getIntakeStatus } from "@/modules/sales-marketing/integrations/enquiry-intake.service";
import { smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";

/** GET /api/v1/integrations/sales-marketing/enquiries/{system}/{externalId} — the ERP enquiry for an external id, its stage and open conflicts. Scope sm.enquiries:read. */
export const GET = smApiRoute<{ system: string; externalId: string }>({ scope: "sm.enquiries:read", endpoint: "GET /enquiries/{system}/{externalId}" }, async ({ actor, params }) => ({
  data: await getIntakeStatus(actor, decodeURIComponent(params.system), decodeURIComponent(params.externalId)),
}));
