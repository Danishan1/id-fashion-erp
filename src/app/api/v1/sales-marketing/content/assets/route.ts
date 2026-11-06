import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createAsset, listAssets } from "@/modules/sales-marketing/content/asset.service";

/** GET: asset library (?search &assetType &status=ACTIVE|ARCHIVED|ANY &tag &ownerUserId &review=approved|unapproved &page &pageSize). */
export const GET = salesMarketingRoute({ module: "marketing_content", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 24));
  return NextResponse.json(await listAssets(actor, { search: sp.get("search") ?? undefined, assetType: sp.get("assetType") ?? undefined, status: sp.get("status") ?? undefined, tag: sp.get("tag") ?? undefined, ownerUserId: sp.get("ownerUserId") ?? undefined, review: sp.get("review") ?? undefined }, page, pageSize));
});

/** POST multipart: file + metadata (JSON in the "metadata" field). Creates version 1. */
export const POST = salesMarketingRoute({ module: "marketing_content", action: "create" }, async ({ req, actor }) => {
  const { form, file } = await readUpload(req);
  let meta: unknown;
  try {
    meta = JSON.parse(String(form.get("metadata") ?? "{}"));
  } catch {
    throw new BusinessRuleError("VALIDATION_ERROR", "Invalid metadata.");
  }
  return NextResponse.json({ data: await createAsset(actor, meta, file) }, { status: 201 });
});

/** Reads one uploaded file from multipart form data (size is checked again in the service). */
async function readUpload(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 21 * 1024 * 1024) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The file is larger than 20 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a file.", { fieldErrors: { file: "Required." } });
  return { form, file: { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || "application/octet-stream" } };
}
