import { readJson, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { deleteSmSubscription, getSmSubscription, updateSmSubscription } from "@/modules/sales-marketing/integrations/sm-webhooks.service";

type P = { id: string };
/** One S&M webhook subscription. PATCH { version, name?, url?, eventTypes?, isActive? } (no secret field). Scope sm.webhooks:manage. */
export const GET = smApiRoute<P>({ scope: "sm.webhooks:manage", endpoint: "GET /webhooks/{id}" }, async ({ actor, params }) => ({ data: await getSmSubscription(actor, params.id) }));
export const PATCH = smApiRoute<P>({ scope: "sm.webhooks:manage", endpoint: "PATCH /webhooks/{id}", write: true }, async ({ req, actor, params }) => ({ data: await updateSmSubscription(actor, params.id, await readJson(req)) }));
export const DELETE = smApiRoute<P>({ scope: "sm.webhooks:manage", endpoint: "DELETE /webhooks/{id}", write: true }, async ({ actor, params }) => ({ data: await deleteSmSubscription(actor, params.id) }));
