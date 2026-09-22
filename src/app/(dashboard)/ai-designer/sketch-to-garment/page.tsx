import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AiDesignerListClient } from "../AiDesignerListClient";

/**
 * Sketch to Garment — a genuinely separate AI Designer sub-module now (was
 * previously just a creationMode flag bolted onto Catalogue Designs, with
 * both kinds of project mixed into one list) — its own list, its own "New
 * Design" entry point, its own detail/edit routes. Still reuses the same
 * underlying AiDesignerProject table (creationMode: SKETCH) and the same
 * downstream wizard component for the steps genuinely common to both
 * (Fabric Selection, Generate Design, Embellishments, Edit Design, Export,
 * …) — only the two sketch-specific steps and this module's own routing are
 * unique to it.
 */
export default async function SketchToGarmentListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_designer", "view").catch(() => notFound());

  return (
    <AiDesignerListClient
      title="Sketch to Garment"
      description="Create a garment design from an uploaded sketch or drawing — your sketch becomes the garment's authoritative structural reference (AI-analyzed first), then carried through the same fabric/customer/product/design/generate wizard as Catalogue Designs. A separate module — its own project list — sharing only the downstream steps that are genuinely the same."
      fetchUrl="/api/v1/ai-designer/projects?creationMode=SKETCH"
      newHref="/ai-designer/sketch-to-garment/new"
      newLabel="New Design From Sketch"
      rowHrefBase="/ai-designer/sketch-to-garment"
    />
  );
}
