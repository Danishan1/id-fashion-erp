import { readJson, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { rotateSmSubscriptionSecret } from "@/modules/sales-marketing/integrations/sm-webhooks.service";

/** POST { version } — new signing secret, returned once (`secretOnce`); the old one stops at once. Scope sm.webhooks:manage. */
export const POST = smApiRoute<{ id: string }>({ scope: "sm.webhooks:manage", endpoint: "POST /webhooks/{id}/rotate-secret", write: true }, async ({ req, actor, params }) => ({ data: await rotateSmSubscriptionSecret(actor, params.id, await readJson(req)) }));
