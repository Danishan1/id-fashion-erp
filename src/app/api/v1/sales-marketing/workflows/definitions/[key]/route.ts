import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { activateDefinition, deactivateDefinition, getDefinition, saveDraft, startWorkflowManually, validateDraft } from "@/modules/sales-marketing/workflows/sm-workflows.service";

/**
 * Phase 15 — one workflow definition.
 *   GET                                   definition, versions, settings / condition fields, permissions needed
 *   PUT  { version, settings, conditions: { entry }, changeNote? }   save the draft version
 *   POST { action: "validate", settings, conditions }                check without saving
 *   POST { action: "activate" | "deactivate", version }              (the activator becomes the run-as user)
 *   POST { action: "start", entityId, entityType? }                  start on one record now
 */
type P = { key: string };

export const GET = salesMarketingRoute<P>({ module: "sales_workflows", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getDefinition(actor, params.key) }));

export const PUT = salesMarketingRoute<P>({ module: "sales_workflows", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await saveDraft(actor, params.key, await req.json()) }));

export const POST = salesMarketingRoute<P>({ module: "sales_workflows", action: "edit" }, async ({ req, actor, params }) => {
  const { action, ...body } = (await req.json()) as { action?: string } & Record<string, unknown>;
  if (action === "validate") return NextResponse.json({ data: await validateDraft(actor, params.key, body) });
  if (action === "activate") return NextResponse.json({ data: await activateDefinition(actor, params.key, body) });
  if (action === "deactivate") return NextResponse.json({ data: await deactivateDefinition(actor, params.key, body) });
  if (action === "start") return NextResponse.json({ data: await startWorkflowManually(actor, params.key, body) }, { status: 201 });
  throw new BusinessRuleError("VALIDATION_ERROR", "Unknown action.", { fieldErrors: { action: "Use validate, activate, deactivate or start." } });
});
