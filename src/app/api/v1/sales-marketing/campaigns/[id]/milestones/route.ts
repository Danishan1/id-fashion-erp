import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addMilestone } from "@/modules/sales-marketing/campaigns/campaign-results.service";

/** POST { subject, dueDate, assignedToUserId?, description? }: a milestone = CRM task on the campaign flagged as milestone. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await addMilestone(actor, params.id, await req.json()) }, { status: 201 }));
