import { NextResponse, type NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { initRequestContext } from "@/core/logging/requestContext";
import { decryptSecret } from "@/core/security/encryption";
import { handleApiError } from "@/lib/api-route";
import { assertCaptureRateLimit } from "@/modules/crm/capture/capture-rate-limit";
import { CrmCaptureRepository } from "@/modules/crm/capture/crm-capture.repository";
import { submitLead } from "@/modules/crm/capture/crm-ingest-events.service";
import { AdapterPayloadError } from "@/modules/crm/capture/providers/lead-provider-adapter";
import { getLeadProviderAdapter } from "@/modules/crm/capture/providers/registry";

const MAX_BODY_BYTES = 256 * 1024;
const LIMIT_PER_MINUTE = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Incoming lead webhook (public — no session). Authenticated by the
 * provider adapter's signature check with the endpoint's own secret. Every
 * lead in the delivery is stored in the ingest inbox and processed through
 * the Lead Ingestion Service; repeats are idempotent. Unknown or inactive
 * endpoints get a plain 404 (nothing about the endpoint is revealed).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string; endpointId: string }> }) {
  try {
    initRequestContext();
    const { provider, endpointId } = await params;
    const adapter = getLeadProviderAdapter(provider);
    const notFound = new BusinessRuleError("NOT_FOUND", "Webhook not found.");
    if (!adapter || !UUID_RE.test(endpointId)) throw notFound;
    const endpoint = await CrmCaptureRepository.findWebhookForDelivery(endpointId);
    if (!endpoint || endpoint.provider !== provider || !endpoint.isActive || endpoint.createdBy.status !== "ACTIVE") throw notFound;
    assertCaptureRateLimit(`webhook:${endpoint.id}`, LIMIT_PER_MINUTE);

    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The payload is larger than 256 KB.");
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The payload is larger than 256 KB.");

    const check = adapter.verifySignature({ headers: req.headers, rawBody, secret: decryptSecret(endpoint.secretEncrypted), now: new Date() });
    if (!check.ok) throw new BusinessRuleError("INVALID_WEBHOOK_SIGNATURE", check.reason);

    let records;
    try {
      records = adapter.parse({ headers: req.headers, rawBody, fieldMapping: (endpoint.fieldMapping as Record<string, string>) ?? {} });
    } catch (e) {
      if (e instanceof AdapterPayloadError) throw new BusinessRuleError("VALIDATION_ERROR", e.message);
      throw e;
    }
    await CrmCaptureRepository.updateWebhook(endpoint.id, { lastReceivedAt: new Date() });

    const actor = { companyId: endpoint.companyId, userId: endpoint.createdByUserId, branchId: null };
    const results = [];
    for (const r of records) {
      const { event, replay } = await submitLead({
        actor,
        context: {
          channel: adapter.channel,
          provider: adapter.provider,
          duplicatePolicy: endpoint.duplicatePolicy,
          defaultSourceId: endpoint.defaultSourceId,
          defaultSourceKey: adapter.defaultSourceKey,
          defaultOwnerUserId: endpoint.defaultOwnerUserId ?? null,
          via: `webhook "${endpoint.name}"`,
        },
        webhookEndpointId: endpoint.id,
        externalEventId: r.externalEventId,
        externalLeadId: r.externalLeadId,
        mapped: r.mapped,
        received: r.raw,
      });
      results.push({ submissionId: event.id, outcome: event.outcome, reason: event.outcomeReason, leadNumber: event.lead?.leadNumber ?? null, replayed: replay, unmappedFields: r.unmappedKeys });
    }
    return NextResponse.json({ data: { received: records.length, results } });
  } catch (error) {
    return handleApiError(error);
  }
}
