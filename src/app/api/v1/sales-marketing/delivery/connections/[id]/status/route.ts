import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { setConnectionStatus } from "@/modules/sales-marketing/delivery/connection.service";

/** POST { status: "ACTIVE" | "DISABLED" } */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor, params }) => {
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "ACTIVE" && body.status !== "DISABLED") throw new BusinessRuleError("VALIDATION_ERROR", "status must be ACTIVE or DISABLED.");
  return NextResponse.json({ data: await setConnectionStatus(actor, params.id, body.status) });
});
