import { apiDownloadJobFile } from "@/modules/sales-marketing/integrations/public-api.service";
import { smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";

/** GET /api/v1/integrations/sales-marketing/jobs/{id}/file — the export file (only the user who ran it, until it expires). Scope sm.jobs:read. */
export const GET = smApiRoute<{ id: string }>({ scope: "sm.jobs:read", endpoint: "GET /jobs/{id}/file" }, async ({ actor, params }) => {
  const f = await apiDownloadJobFile(actor, params.id);
  return new Response(new Uint8Array(f.buffer), { status: 200, headers: { "Content-Type": f.mimeType, "Content-Disposition": `attachment; filename="${f.fileName.replace(/["\r\n]/g, "")}"`, "Cache-Control": "no-store" } });
});
