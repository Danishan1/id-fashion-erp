import { crmRoute } from "@/modules/crm/core/crm-route";
import { buildImportErrorFile } from "@/modules/crm/imports/crm-import.service";

/** ?format=csv|xlsx&which=problems|all — original columns plus status, reason and duplicate information. */
export const GET = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => {
  const sp = req.nextUrl.searchParams;
  const file = await buildImportErrorFile(actor, params.id, sp.get("format") === "xlsx" ? "xlsx" : "csv", sp.get("which") === "all" ? "all" : "problems");
  return new Response(new Uint8Array(file.body), {
    headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`, "Cache-Control": "no-store" },
  });
});
