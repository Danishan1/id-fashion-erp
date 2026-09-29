import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSampleRequestById } from "@/modules/sampling/sample.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DesignBomMaterialsPanel } from "./DesignBomMaterialsPanel";

// The "Design BOM" is nothing new — it's simply this sample's own current
// SampleMaterial list (the same rows SampleWorkflowPanel's own materials
// table and "Update BOM" action already manage), just surfaced here as its
// own view, reachable directly from the Sampling list. Deliberately does
// NOT also show the linked Style's own real BOM — that already has its own
// dedicated surfaces (the "Style" tab on /bom-mrp, and the standalone
// /bom-mrp/[productId] page).
export default async function DesignBomPage({ params }: { params: Promise<{ sampleRequestId: string }> }) {
  const { sampleRequestId } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "sampling", "view").catch(() => notFound());

  const request = await getSampleRequestById(session!.user.companyId, sampleRequestId).catch(() => null);
  if (!request) notFound();

  const currentVersion = request.versions[0] ?? null;
  const canEditMaterials = await PermissionService.can(session!.user.id, "sampling", "edit");

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Sampling", href: "/sampling" },
          { label: request.requestNumber, href: `/sampling/${sampleRequestId}` },
          { label: "Design BOM" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Design BOM — {request.styleName ?? request.requestNumber}{" "}
          <span className="text-sm text-zinc-400">({request.requestNumber})</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The materials actually planned/used for this design&rsquo;s sample, from its current version.
        </p>
      </div>
      <DesignBomMaterialsPanel
        materials={JSON.parse(JSON.stringify(currentVersion?.materials ?? []))}
        canEditMaterials={canEditMaterials}
      />
    </div>
  );
}
