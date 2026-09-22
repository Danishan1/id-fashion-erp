import { notFound, redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProjectById } from "@/modules/ai-designer/ai-designer.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { EditDesignWorkspace } from "../../../_shared/EditDesignWorkspace";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Sketch to Garment's own Edit Design workspace — reuses the exact same workspace component Catalogue Designs uses, with basePath pointed at this module's own URL. */
export default async function SketchToGarmentEditWorkspacePage({ params }: PageProps) {
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

  if (project.creationMode === "STANDARD") redirect(`/ai-designer/catalogue-designs/${id}/edit`);
  if (!project.currentVersion?.currentImage) notFound();

  return (
    <EditDesignWorkspace
      key={id}
      projectId={id}
      initialProject={JSON.parse(JSON.stringify(project))}
      basePath="/ai-designer/sketch-to-garment"
    />
  );
}
