import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { approveVersion, getModel, rejectVersion, returnVersionToDraft, submitVersion } from "@/modules/sales-marketing/attribution/attribution-model.service";

const ACTIONS = { submit: submitVersion, "return-to-draft": returnVersionToDraft, approve: approveVersion, reject: rejectVersion } as const;

/** POST submit | return-to-draft | approve { comment? } | reject { reason }. */
export const POST = salesMarketingRoute<{ id: string; versionId: string; action: string }>({ module: "marketing_attribution", action: "view" }, async ({ req, actor, params }) => {
  const fn = ACTIONS[params.action as keyof typeof ACTIONS];
  if (!fn) throw new BusinessRuleError("NOT_FOUND", "Unknown action.");
  await fn(actor, params.id, params.versionId, await req.json().catch(() => ({})));
  return NextResponse.json({ data: await getModel(actor, params.id) });
});
