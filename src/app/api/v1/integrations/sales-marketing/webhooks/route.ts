import { pageOf, readJson, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { createSmSubscription, listSmSubscriptions } from "@/modules/sales-marketing/integrations/sm-webhooks.service";

/**
 * S&M webhook subscriptions over the API (scope sm.webhooks:manage; the key's
 * user needs sales_integrations.edit). POST returns the signing secret once
 * (`secretOnce`). Destinations: https, public addresses only.
 */
export const GET = smApiRoute({ scope: "sm.webhooks:manage", endpoint: "GET /webhooks" }, async ({ req, actor }) => {
  pageOf(req);
  return { data: await listSmSubscriptions(actor) };
});

export const POST = smApiRoute({ scope: "sm.webhooks:manage", endpoint: "POST /webhooks", write: true }, async ({ req, actor }) => ({ data: await createSmSubscription(actor, await readJson(req)), status: 201 }));
