/**
 * One-off (re-runnable) content-generation tool: produces a real reference
 * photo under public/ai-designer-reference/<slug>.jpg for every distinct
 * Product Design option value across the whole AI Designer attribute
 * catalog (design-attribute-catalog.ts), using whichever provider
 * IMAGE_GENERATION_PROVIDER selects (this dev environment: Cloudflare,
 * confirmed healthy). Resumable — skips any slug that already has a file,
 * so re-running after adding a new category/attribute only generates the
 * genuinely new values.
 *
 * Run: npx tsx scripts/generate-ai-designer-reference-images.ts
 * Optional: pass a number to cap how many NEW images this run generates,
 * e.g. `npx tsx scripts/generate-ai-designer-reference-images.ts 20` — since
 * a free-tier provider can be slow/rate-limited, running in bounded batches
 * is often more practical than one very long run.
 */
import "dotenv/config";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PRODUCT_DESIGN_ATTRIBUTES_BY_CATEGORY } from "../src/core/ai-designer/catalogs/design-attribute-catalog";
import { slugifyDesignOptionValue, buildReferenceImagePrompt } from "../src/core/ai-designer/catalogs/reference-image-prompt";
import { getImageGenerationProvider } from "../src/core/ai/image-generation/factory";

const OUTPUT_DIR = path.join(process.cwd(), "public", "ai-designer-reference");
const DELAY_MS = 1500;

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function collectDistinctValues(): string[] {
  const seen = new Map<string, string>(); // slug -> original value (first one wins)
  for (const attrs of Object.values(PRODUCT_DESIGN_ATTRIBUTES_BY_CATEGORY)) {
    for (const attr of attrs) {
      for (const opt of attr.options) {
        const slug = slugifyDesignOptionValue(opt);
        if (slug && !seen.has(slug)) seen.set(slug, opt);
      }
    }
  }
  return [...seen.values()];
}

async function main() {
  const cap = process.argv[2] ? Number(process.argv[2]) : Infinity;
  await mkdir(OUTPUT_DIR, { recursive: true });

  const values = collectDistinctValues();
  console.log(`Found ${values.length} distinct option values across the catalog.`);

  const provider = getImageGenerationProvider();
  console.log(`Using provider: ${provider.name} (${provider.model})`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  // Caps total ATTEMPTS this run, not just successes — without this, a
  // provider that's genuinely out of credits/quota would fail every single
  // value and grind through the entire catalog uselessly before the cap
  // ever had a chance to stop it (confirmed live: this is exactly what
  // happened on the first run against this dev environment's
  // credits-exhausted Cloudflare account).
  let attempts = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;

  for (const value of values) {
    if (generated >= cap) {
      console.log(`Reached cap of ${cap} new images for this run — stopping (re-run to continue).`);
      break;
    }

    const slug = slugifyDesignOptionValue(value);
    const outPath = path.join(OUTPUT_DIR, `${slug}.jpg`);
    if (await fileExists(outPath)) {
      skipped++;
      continue;
    }

    attempts++;
    try {
      const result = await provider.generate({ prompt: buildReferenceImagePrompt(value), count: 1 });
      const img = result.images[0];
      if (!img) throw new Error("Provider returned zero images.");
      const jpegBuffer = await sharp(img.buffer).jpeg({ quality: 88 }).toBuffer();
      await writeFile(outPath, jpegBuffer);
      generated++;
      consecutiveFailures = 0;
      console.log(`[${generated}] Generated: "${value}" -> ${slug}.jpg`);
    } catch (err) {
      failed++;
      consecutiveFailures++;
      console.error(`Failed: "${value}" — ${err instanceof Error ? err.message : String(err)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(
          `${MAX_CONSECUTIVE_FAILURES} consecutive failures — the provider is very likely out of credits/quota right now. Stopping early instead of grinding through the rest of the catalog (re-run once the provider has credits).`
        );
        break;
      }
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. Attempts: ${attempts}, generated: ${generated}, already existed (skipped): ${skipped}, failed: ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
