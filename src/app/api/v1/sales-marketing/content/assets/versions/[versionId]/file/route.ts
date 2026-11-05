import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { readAssetVersionFile } from "@/modules/sales-marketing/content/asset.service";
import { ASSET_MIME, isAssetMime } from "@/modules/sales-marketing/content/content-registry";

/**
 * The file of one asset version, for signed-in users with marketing_content.view.
 * ?disposition=inline only for previewable types (images, PDF, video); served
 * with nosniff and a sandboxing CSP so nothing in the file can run as this app.
 */
export const GET = salesMarketingRoute<{ versionId: string }>({ module: "marketing_content", action: "view" }, async ({ req, actor, params }) => {
  const f = await readAssetVersionFile(actor, params.versionId);
  const previewable = isAssetMime(f.mimeType) && ASSET_MIME[f.mimeType].preview !== null;
  const inline = req.nextUrl.searchParams.get("disposition") === "inline" && previewable;
  const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(f.buffer), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Length": String(f.buffer.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=300",
      ETag: `"${f.sha256}"`,
    },
  });
});
