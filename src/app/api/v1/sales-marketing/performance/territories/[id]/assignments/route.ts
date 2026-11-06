import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addAssignment } from "@/modules/sales-marketing/performance/territory.service";

/** POST: assign a rep { userId, isPrimary, startDate, endDate? }. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await addAssignment(actor, params.id, await req.json()) }, { status: 201 })
);
