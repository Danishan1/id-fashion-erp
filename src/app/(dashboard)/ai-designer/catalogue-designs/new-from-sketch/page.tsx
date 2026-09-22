import { redirect } from "next/navigation";

/**
 * Sketch to Garment moved to its own module — this page's own real content
 * moved to /ai-designer/sketch-to-garment/new. Kept as a bare redirect
 * (rather than deleting the route entirely) because an old bookmark/link to
 * this exact URL would otherwise fall through to the sibling dynamic route
 * (catalogue-designs/[id]) and crash trying to query a project by the
 * literal id "new-from-sketch" — confirmed live, this is the actual bug
 * that prompted adding this file back.
 */
export default function OldNewFromSketchRedirect() {
  redirect("/ai-designer/sketch-to-garment/new");
}
