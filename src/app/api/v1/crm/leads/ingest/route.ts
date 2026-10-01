import { NextResponse, type NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { initRequestContext } from "@/core/logging/requestContext";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handleApiError, requireSession } from "@/lib/api-route";
import { mapApiBody } from "@/modules/crm/capture/api-ingest";
import { authenticateApiKey } from "@/modules/crm/capture/crm-api-keys.service";
import { submitLead } from "@/modules/crm/capture/crm-ingest-events.service";
import { assertCaptureRateLimit } from "@/modules/crm/capture/capture-rate-limit";
import type { CrmActor } from "@/modules/crm/core/crm-actor";
import type { IngestContext } from "@/modules/crm/ingestion/lead-ingest.service";

const MAX_BODY_BYTES = 100 * 1024;
const LIMIT_PER_MINUTE = 120;
const STATUS_BY_OUTCOME: Record<string, number> = { IMPORTED: 201, UPDATED: 200, SKIPPED: 200, FLAGGED: 202, FAILED: 422 };

/**
 * POST /api/v1/crm/leads/ingest — lead ingestion for website forms and other
 * systems. Every submission goes through the Lead Ingestion Service (never
 * a direct insert).
 *
 * Auth: `Authorization: Bearer crmk_…` (or `X-API-Key`) — a CRM API key from
 * CRM Settings → API keys; or a signed-in user with crm.create.
 * Idempotency: send `Idempotency-Key` (or `externalEventId`); a repeat
 * returns the first result with `Idempotent-Replayed: true`. `externalLeadId`
 * makes the same external lead recognisable across events.
 * Responses: 201 imported · 200 updated / skipped · 202 flagged for review ·
 * 422 invalid · 401 bad key · 429 rate limited.
 */
export async function POST(req: NextRequest) {
  try {
    initRequestContext();
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The request body is larger than 100 KB.");
    const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    const presented = bearer ?? req.headers.get("x-api-key");

    let actor: CrmActor;
    let context: Omit<IngestContext, "channel" | "via"> & { via: string };
    let apiKeyId: string | null = null;
    let policyFromKey = false;
    if (presented) {
      const key = await authenticateApiKey(presented);
      if (!key) throw new BusinessRuleError("INVALID_API_CREDENTIALS", "Invalid, expired or revoked API key.");
      assertCaptureRateLimit(`key:${key.id}`, LIMIT_PER_MINUTE);
      actor = { companyId: key.companyId, userId: key.createdByUserId, branchId: null };
      apiKeyId = key.id;
      policyFromKey = true;
      context = {
        provider: "api",
        duplicatePolicy: key.duplicatePolicy,
        defaultSourceId: key.defaultSourceId,
        defaultOwnerUserId: key.defaultOwnerUserId ?? null,
        via: `API key "${key.name}"`,
      };
    } else {
      const session = await requireSession();
      await PermissionService.assert(session.user.id, "crm", "create");
      assertCaptureRateLimit(`user:${session.user.id}`, LIMIT_PER_MINUTE);
      actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null };
      context = { provider: "api", duplicatePolicy: "UPDATE", via: "API" };
    }

    const text = await req.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The request body is larger than 100 KB.");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BusinessRuleError("VALIDATION_ERROR", "The body must be JSON.");
    }
    const body = mapApiBody(json);
    const channel = body.channel === "WEBSITE_FORM" ? "WEBSITE_FORM" : "API";
    const fullContext: IngestContext = {
      ...context,
      channel,
      duplicatePolicy: !policyFromKey && body.duplicatePolicy ? body.duplicatePolicy : context.duplicatePolicy,
      defaultSourceKey: channel === "WEBSITE_FORM" ? "website" : "api",
    };
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;
    const { event, result, replay } = await submitLead({
      actor,
      context: fullContext,
      apiKeyId,
      idempotencyKey,
      externalEventId: body.externalEventId,
      externalLeadId: body.externalLeadId,
      mapped: body.mapped,
      received: json,
    });
    if (replay && event.status === "RECEIVED") throw new BusinessRuleError("REQUEST_IN_PROGRESS", "This request is still being processed. Retry in a few seconds.");
    const outcome = event.outcome === "PENDING" ? "FAILED" : event.outcome;
    return NextResponse.json(
      {
        data: {
          submissionId: event.id,
          outcome,
          reason: event.outcomeReason,
          leadId: event.lead?.id ?? null,
          leadNumber: event.lead?.leadNumber ?? null,
          messages: result?.messages ?? [],
          unmappedFields: body.unmappedFields,
          replayed: replay,
        },
      },
      { status: replay ? 200 : (STATUS_BY_OUTCOME[outcome] ?? 200), headers: replay ? { "Idempotent-Replayed": "true" } : undefined }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
