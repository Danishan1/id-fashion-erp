import { notFound, redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProjectById } from "@/modules/ai-designer/ai-designer.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { EditDesignWorkspace } from "../../../_shared/EditDesignWorkspace";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * The Edit Design workspace — a dedicated, single-page CAD-like editor
 * (canvas + contextual property panels), separate from the step-by-step
 * wizard on the main project page. Reached via "Open Design Editor" on that
 * page's own EDIT step.
 */
export default async function AiDesignerEditWorkspacePage({ params }: PageProps) {
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

  if (project.creationMode === "SKETCH") redirect(`/ai-designer/sketch-to-garment/${id}/edit`);
  if (!project.currentVersion?.currentImage) notFound();

  return <EditDesignWorkspace key={id} projectId={id} initialProject={JSON.parse(JSON.stringify(project))} />;
}
