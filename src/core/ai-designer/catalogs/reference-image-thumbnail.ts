import sharp from "sharp";

/**
 * Server-only (uses `sharp`, a native module — never import this from a
 * client component). Every Product Design reference photo, whether
 * AI-generated (scripts/generate-ai-designer-reference-images.ts) or
 * admin-uploaded (ai-designer-attribute-master.service.ts's
 * uploadOptionReferenceImage), is only ever displayed as a small ~80px (up
 * to ~160px @2x) thumbnail — see DesignOptionImage's `h-16 w-16 sm:h-20
 * sm:w-20` classes. A raw AI-provider image (1024x1024+) or a phone-camera
 * upload can be several MB; resizing + re-encoding down to a size that
 * actually matches the display keeps every one of these files a few KB
 * instead, with no visible quality loss at that size, and keeps the whole
 * catalog (~200 values) lightweight rather than accumulating into tens of
 * MB.
 */
export async function toReferenceImageThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(320, 320, { fit: "cover", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
