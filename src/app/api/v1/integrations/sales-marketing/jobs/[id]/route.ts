import { apiGetJob } from "@/modules/sales-marketing/integrations/public-api.service";
import { smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";

/** GET /api/v1/integrations/sales-marketing/jobs/{id} — status of a job this key's user started. Scope sm.jobs:read. */
export const GET = smApiRoute<{ id: string }>({ scope: "sm.jobs:read", endpoint: "GET /jobs/{id}" }, async ({ actor, params }) => ({ data: await apiGetJob(actor, params.id) }));
