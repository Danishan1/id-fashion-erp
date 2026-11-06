import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getSmApiKey, revokeSmApiKey, rotateSmApiKey, updateSmApiKey } from "@/modules/sales-marketing/integrations/sm-api-keys.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };
/** GET / PATCH one key; POST { action: "rotate", graceHours? } (edit; new key once) or { action: "revoke", reason } (approve). */
export const GET = salesMarketingRoute<P>({ module: "sales_integrations", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getSmApiKey(actor, params.id) }));
export const PATCH = salesMarketingRoute<P>({ module: "sales_integrations", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await updateSmApiKey(actor, params.id, await req.json()) }));
export const POST = salesMarketingRoute<P>({ module: "sales_integrations", action: "edit" }, async ({ req, actor, params }) => {
  const { action, ...body } = (await req.json()) as { action?: string } & Record<string, unknown>;
  if (action === "rotate") return NextResponse.json({ data: await rotateSmApiKey(actor, params.id, body) }, { headers: { "Cache-Control": "no-store" } });
  if (action === "revoke") return NextResponse.json({ data: await revokeSmApiKey(actor, params.id, body) });
  throw new BusinessRuleError("VALIDATION_ERROR", "Unknown action.", { fieldErrors: { action: "Use rotate or revoke." } });
});
