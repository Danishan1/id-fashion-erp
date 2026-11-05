import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { createCampaign, listCampaigns } from "@/modules/sales-marketing/campaigns/campaign.service";

/** GET: campaigns the user can see (filters: status=A,B typeId objectiveId ownerUserId departmentId salesChannelId from to search; page, pageSize). */
export const GET = salesMarketingRoute({ module: "marketing_campaigns", action: "view" }, async ({ req, actor }) => {
  const query = parseListQuery(req.nextUrl.searchParams);
  const { data, total } = await listCampaigns(actor, { ...Object.fromEntries(req.nextUrl.searchParams), search: query.search }, { skip: query.skip, take: query.take });
  return NextResponse.json({ data, meta: buildListMeta(total, query.page, query.pageSize) });
});

/** POST: new draft campaign; a repeated idempotencyKey returns the first one (200). */
export const POST = salesMarketingRoute({ module: "marketing_campaigns", action: "create" }, async ({ req, actor }) => {
  const r = await createCampaign(actor, await req.json());
  return NextResponse.json({ data: r }, { status: r.replayed ? 200 : 201 });
});
