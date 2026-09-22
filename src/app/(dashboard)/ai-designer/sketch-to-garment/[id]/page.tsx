import { notFound, redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProjectById } from "@/modules/ai-designer/ai-designer.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { AiDesignerWorkflowPanel } from "../../_shared/AiDesignerWorkflowPanel";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Sketch to Garment's own detail/workflow page — reuses the exact same wizard component Catalogue Designs uses (a real, separate module, but the downstream steps genuinely overlap), just with basePath pointed at this module's own URL. */
export default async function SketchToGarmentDetailPage({ params }: PageProps) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_designer", "view").catch(() => notFound());

  const { id } = await params;

  let project;
  try {
    project = await getProjectById(session!.user.companyId, id);
  } catch (err) {
    if (err instanceof BusinessRuleError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  // A STANDARD project's real home is /ai-designer/catalogue-designs/[id] —
  // redirect rather than 404 so an old/bookmarked link still works.
  if (project.creationMode === "STANDARD") redirect(`/ai-designer/catalogue-designs/${id}`);

  return (
    <AiDesignerWorkflowPanel
      key={id}
      projectId={id}
      initialProject={JSON.parse(JSON.stringify(project))}
      basePath="/ai-designer/sketch-to-garment"
    />
  );
}
