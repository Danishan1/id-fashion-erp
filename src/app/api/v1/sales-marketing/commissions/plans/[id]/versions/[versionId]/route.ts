import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { saveDraftVersion } from "@/modules/sales-marketing/commissions/commission-plan.service";

export const PATCH = salesMarketingRoute<{ id: string; versionId: string }>({ module: "sales_commissions", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await saveDraftVersion(actor, params.id, params.versionId, await req.json()) })
);
