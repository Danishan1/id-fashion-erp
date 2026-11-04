import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { startNewVersion } from "@/modules/sales-marketing/commissions/commission-plan.service";

/** POST: a new draft version copied from the latest. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_commissions", action: "edit" }, async ({ actor, params }) => NextResponse.json({ data: await startNewVersion(actor, params.id) }, { status: 201 }));
