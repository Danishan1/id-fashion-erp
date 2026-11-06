import { smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { apiCampaignPerformance } from "@/modules/sales-marketing/integrations/public-api.service";

/** GET /api/v1/integrations/sales-marketing/campaigns/performance — attribution & ROI per campaign (Phase 13 report). Query: modelId, campaignId, from, to, basis. Scope sm.performance:read. */
export const GET = smApiRoute({ scope: "sm.performance:read", endpoint: "GET /campaigns/performance" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return { data: await apiCampaignPerformance(actor, { modelId: sp.get("modelId") ?? undefined, campaignId: sp.get("campaignId") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, basis: sp.get("basis") ?? undefined }) };
});
