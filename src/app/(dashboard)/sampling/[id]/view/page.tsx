import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSampleRequestById } from "@/modules/sampling/sample.service";
import { DesignViewClient } from "./DesignViewClient";

/**
 * A read-only, ecommerce-style product page for one Design (Sample
 * Request) — big main image, every other uploaded image as a smaller
 * clickable thumbnail row, and the design's own full Sampling Cost
 * breakdown from its current version. Deliberately separate from
 * SampleWorkflowPanel (the full editable workflow page at /sampling/[id])
 * — this is a single page meant to be shared/glanced at, not an editing
 * surface.
 */
export default async function DesignViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "sampling", "view").catch(() => notFound());

  const request = await getSampleRequestById(session!.user.companyId, id).catch(() => null);
  if (!request) notFound();

  return <DesignViewClient sampleRequestId={id} initialRequest={JSON.parse(JSON.stringify(request))} />;
}
