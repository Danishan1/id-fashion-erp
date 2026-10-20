import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { cancelExecution, getExecution, pauseExecution, resumeExecution, retryExecution } from "@/modules/crm/workflows/crm-workflows.service";

/**
 * Phase 18 — /api/v1/crm/workflow-executions/{id}[/cancel|pause|resume|retry]
 * GET returns the execution with its full step trace.
 */
type Params = { path: string[] };

function notFound(): never {
  throw new BusinessRuleError("NOT_FOUND", "Unknown workflow execution endpoint.");
}

export const GET = crmRoute<Params>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => {
  const [id, ...rest] = params.path;
  if (!id || rest.length) notFound();
  return NextResponse.json({ data: await getExecution(actor, id) });
});

const ACTIONS = { cancel: cancelExecution, pause: pauseExecution, resume: resumeExecution, retry: retryExecution } as const;

export const POST = crmRoute<Params>({ module: "crm_settings", action: "edit" }, async ({ params, actor }) => {
  const [id, sub, ...rest] = params.path;
  if (!id || !sub || rest.length || !(sub in ACTIONS)) notFound();
  return NextResponse.json({ data: await ACTIONS[sub as keyof typeof ACTIONS](actor, id) });
});
