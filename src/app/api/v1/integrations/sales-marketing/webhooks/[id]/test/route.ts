import { readJson, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { testSmSubscription } from "@/modules/sales-marketing/integrations/sm-webhooks.service";

/** POST { eventType? } — sends one signed, synthetic test event now and returns the outcome. Scope sm.webhooks:manage. */
export const POST = smApiRoute<{ id: string }>({ scope: "sm.webhooks:manage", endpoint: "POST /webhooks/{id}/test", write: true }, async ({ req, actor, params }) => ({ data: await testSmSubscription(actor, params.id, await readJson(req)) }));
