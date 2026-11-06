import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addAssignment } from "@/modules/sales-marketing/commissions/commission-plan.service";

export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_commissions", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await addAssignment(actor, params.id, await req.json()) }, { status: 201 }));
