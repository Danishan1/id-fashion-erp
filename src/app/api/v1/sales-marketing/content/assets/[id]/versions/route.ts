import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { addAssetVersion } from "@/modules/sales-marketing/content/asset.service";

/** POST multipart: a replacement file → a new version (earlier versions and their uses are kept). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "edit" }, async ({ req, actor, params }) => {
  const { form, file } = await readUpload(req);
  const note = form.get("changeNote");
  return NextResponse.json({ data: await addAssetVersion(actor, params.id, file, typeof note === "string" ? note : null) }, { status: 201 });
});

/** Reads one uploaded file from multipart form data (size is checked again in the service). */
async function readUpload(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 21 * 1024 * 1024) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The file is larger than 20 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a file.", { fieldErrors: { file: "Required." } });
  return { form, file: { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || "application/octet-stream" } };
}
