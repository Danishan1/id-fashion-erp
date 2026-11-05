import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { endAssignment, removeAssignment } from "@/modules/sales-marketing/performance/territory.service";

type P = { id: string; assignmentId: string };

/** PATCH: end the assignment { endDate }. DELETE: remove one that hasn't started. */
export const PATCH = salesMarketingRoute<P>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await endAssignment(actor, params.id, params.assignmentId, await req.json()) })
);

export const DELETE = salesMarketingRoute<P>({ module: "sales_performance", action: "edit" }, async ({ actor, params }) =>
  NextResponse.json({ data: await removeAssignment(actor, params.id, params.assignmentId) })
);
