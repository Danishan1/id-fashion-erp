import { submitEnquiry } from "@/modules/sales-marketing/integrations/enquiry-intake.service";
import { withIdempotency } from "@/modules/sales-marketing/integrations/idempotency";
import { readJson, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";

/**
 * POST /api/v1/integrations/sales-marketing/enquiries — create or update one
 * enquiry by (system, externalId). 201 CREATED; 200 UPDATED / UNCHANGED /
 * STALE_IGNORED, with any conflicts listed (never applied silently).
 * Optional Idempotency-Key. Scope sm.enquiries:write.
 */
export const POST = smApiRoute({ scope: "sm.enquiries:write", endpoint: "POST /enquiries", write: true }, async ({ req, actor, key }) => {
  const body = await readJson(req);
  const r = await withIdempotency({ companyId: key.companyId, apiKeyId: key.keyId }, req.headers.get("idempotency-key"), `POST /enquiries ${JSON.stringify(body)}`, async () => {
    const out = await submitEnquiry(actor, key, body);
    return { status: out.result === "CREATED" ? 201 : 200, data: out };
  });
  return { data: r.data, status: r.status, headers: (r.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string> };
});
