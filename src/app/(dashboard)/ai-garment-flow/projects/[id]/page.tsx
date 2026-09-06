import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAiGarmentProjectById } from "@/modules/ai-garment-flow/ai-garment-project.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { AiGarmentProjectWorkflowPanel } from "../AiGarmentProjectWorkflowPanel";

export default async function AiGarmentProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_garment_flow", "view").catch(() => notFound());

  const project = await getAiGarmentProjectById(session!.user.companyId, id).catch(() => null);
  if (!project) notFound();

  const partyName = project.buyer?.name ?? project.customer?.name ?? "No buyer/customer linked yet";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "AI Garment Flow", href: "/ai-garment-flow" },
              { label: "Projects", href: "/ai-garment-flow/projects" },
              { label: project.projectNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {project.projectNumber} — {project.projectName}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {partyName} · {project.sourceType === "FABRIC" ? "Started From Fabric" : "Started From Reference"} · Created by{" "}
            {project.createdBy.fullName}
          </p>
        </div>
        <Barcode value={project.projectNumber} />
      </div>

      {/* Decimal/Date fields aren't plain-serializable across the server/client
          boundary — round-trip through JSON, same pattern used by Sampling,
          Sales Orders, and Buyer Enquiries. `key={id}` forces a remount on
          client-side navigation between two different projects. */}
      <AiGarmentProjectWorkflowPanel key={id} projectId={id} initialProject={JSON.parse(JSON.stringify(project))} />
    </div>
  );
}
