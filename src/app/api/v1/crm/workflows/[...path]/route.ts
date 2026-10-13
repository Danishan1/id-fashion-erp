import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import {
  changeWorkflowStatus,
  discardDraft,
  duplicateWorkflow,
  getVersion,
  getWorkflow,
  listExecutions,
  listVersions,
  publishWorkflow,
  revealWebhookSecret,
  rotateWebhookSecret,
  runWorkflowManually,
  saveDraft,
  testWorkflow,
  updateWorkflow,
  validateWorkflow,
} from "@/modules/crm/workflows/crm-workflows.service";
import { parseExecutionFilters } from "@/modules/crm/workflows/workflow.schema";

/**
 * Phase 18 — one catch-all for /api/v1/crm/workflows/{id}/... (keeps folder nesting shallow).
 *
 *   GET    /{id}                       workflow + current draft/published version
 *   PATCH  /{id}                       { version, name?, description? }
 *   PUT    /{id}/draft                 { version, definition, changeNote? } → { workflow, issues }
 *   DELETE /{id}/draft                 { version }  (published workflows only)
 *   POST   /{id}/validate              → { errors, warnings }
 *   POST   /{id}/publish               { version, changeNote? }  (422 CRM_WORKFLOW_INVALID with details)
 *   POST   /{id}/pause|resume|disable|archive|restore   { version }
 *   POST   /{id}/duplicate             { name? }
 *   POST   /{id}/test                  { entityType, entityId, source?, triggerPayload? }  dry run
 *   POST   /{id}/run                   { entityType, entityId }  manual start
 *   GET    /{id}/versions              version history
 *   GET    /{id}/versions/{versionId}  one version (with definition)
 *   GET    /{id}/executions            executions of this workflow
 *   GET    /{id}/webhook-secret        reveal (crm_settings.edit)
 *   POST   /{id}/webhook-secret        rotate
 */
type Params = { path: string[] };

const LIFECYCLE = { pause: "PAUSED", resume: "PUBLISHED", disable: "DISABLED", archive: "ARCHIVED", restore: "DRAFT" } as const;

function notFound(): never {
  throw new BusinessRuleError("NOT_FOUND", "Unknown workflow endpoint.");
}

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

const ok = (data: unknown, status = 200) => NextResponse.json({ data }, { status });

export const GET = crmRoute<Params>({ module: "crm_settings", action: "view" }, async ({ req, params, actor }) => {
  const [id, sub, subId, ...rest] = params.path;
  if (!id || rest.length) notFound();
  if (!sub) return ok(await getWorkflow(actor, id));
  if (sub === "versions" && !subId) return ok(await listVersions(actor, id));
  if (sub === "versions" && subId) return ok(await getVersion(actor, id, subId));
  if (sub === "executions" && !subId) {
    const sp = req.nextUrl.searchParams;
    const query = parseListQuery(sp, "createdAt");
    const { data, totalCount } = await listExecutions(actor, { ...parseExecutionFilters(sp), workflowId: id }, query);
    return crmListResponse(data, totalCount, query);
  }
  if (sub === "webhook-secret" && !subId) {
    // Revealing a secret needs edit rights, not just view.
    await PermissionService.assert(actor.userId, "crm_settings", "edit");
    return ok(await revealWebhookSecret(actor, id));
  }
  notFound();
});

export const PATCH = crmRoute<Params>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => {
  const [id, sub] = params.path;
  if (!id || sub || params.path.length > 1) notFound();
  return ok(await updateWorkflow(actor, id, await body(req)));
});

export const PUT = crmRoute<Params>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => {
  const [id, sub, ...rest] = params.path;
  if (!id || sub !== "draft" || rest.length) notFound();
  return ok(await saveDraft(actor, id, await body(req)));
});

export const DELETE = crmRoute<Params>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => {
  const [id, sub, ...rest] = params.path;
  if (!id || sub !== "draft" || rest.length) notFound();
  return ok(await discardDraft(actor, id, await body(req)));
});

export const POST = crmRoute<Params>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => {
  const [id, sub, ...rest] = params.path;
  if (!id || !sub || rest.length) notFound();
  if (sub in LIFECYCLE) return ok(await changeWorkflowStatus(actor, id, LIFECYCLE[sub as keyof typeof LIFECYCLE], await body(req)));
  switch (sub) {
    case "validate":
      return ok(await validateWorkflow(actor, id));
    case "publish":
      return ok(await publishWorkflow(actor, id, await body(req)));
    case "duplicate":
      return ok(await duplicateWorkflow(actor, id, await body(req)), 201);
    case "test":
      return ok(await testWorkflow(actor, id, await body(req)));
    case "run":
      return ok(await runWorkflowManually(actor, id, await body(req)), 201);
    case "webhook-secret":
      return ok(await rotateWebhookSecret(actor, id));
  }
  notFound();
});
