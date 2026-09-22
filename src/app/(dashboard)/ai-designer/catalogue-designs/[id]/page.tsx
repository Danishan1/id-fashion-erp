import { notFound, redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProjectById } from "@/modules/ai-designer/ai-designer.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { AiDesignerWorkflowPanel } from "../../_shared/AiDesignerWorkflowPanel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AiDesignerProjectDetailPage({ params }: PageProps) {
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

  // Sketch to Garment is a genuinely separate module now — a SKETCH-mode
  // project's real home is /ai-designer/sketch-to-garment/[id], never this
  // route. Redirect rather than 404 so old bookmarks/links still work.
  if (project.creationMode === "SKETCH") redirect(`/ai-designer/sketch-to-garment/${id}`);

  return <AiDesignerWorkflowPanel key={id} projectId={id} initialProject={JSON.parse(JSON.stringify(project))} />;
}
