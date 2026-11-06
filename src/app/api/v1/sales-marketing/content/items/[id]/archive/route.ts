import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { setContentArchived } from "@/modules/sales-marketing/content/campaign-content.service";

/** POST { archived: boolean, version } */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "view" }, async ({ req, actor, params }) => {
  const b = (await req.json().catch(() => ({}))) as { archived?: unknown; version?: unknown };
  if (typeof b.archived !== "boolean" || typeof b.version !== "number") throw new BusinessRuleError("VALIDATION_ERROR", "archived and version are required.");
  return NextResponse.json({ data: await setContentArchived(actor, params.id, b.archived, b.version) });
});
