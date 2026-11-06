import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { z } from "zod";
import { setPlanActive } from "@/modules/sales-marketing/commissions/commission-plan.service";

export const PATCH = salesMarketingRoute<{ id: string }>({ module: "sales_commissions", action: "edit" }, async ({ req, actor, params }) => {
  const { isActive } = z.object({ isActive: z.boolean() }).strict().parse(await req.json());
  return NextResponse.json({ data: await setPlanActive(actor, params.id, isActive) });
});
