import { withIdempotency } from "@/modules/sales-marketing/integrations/idempotency";
import { apiStartExport } from "@/modules/sales-marketing/integrations/public-api.service";
import { readJson, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";

/**
 * POST /api/v1/integrations/sales-marketing/exports — starts a background
 * export (Phase 14 job) as the key's user: { recordType: ENQUIRY | QUOTATION |
 * CAMPAIGN | PROMOTION, filter?, format?: CSV | XLSX } → 202 { jobId }. Poll
 * GET /jobs/{id}, then download GET /jobs/{id}/file. Scope sm.exports:create.
 */
export const POST = smApiRoute({ scope: "sm.exports:create", endpoint: "POST /exports", write: true }, async ({ req, actor, key }) => {
  const body = await readJson(req);
  const idem = req.headers.get("idempotency-key");
  const r = await withIdempotency({ companyId: key.companyId, apiKeyId: key.keyId }, idem, `POST /exports ${JSON.stringify(body)}`, async () => ({ status: 202, data: await apiStartExport(actor, body, idem) }));
  return { data: r.data, status: r.status, headers: (r.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string> };
});
