import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getReplicateProjectById } from "@/modules/ai-designer/replicate-design.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { EditReplicateDesignWorkspace } from "./EditReplicateDesignWorkspace";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * The Edit Design workspace for Replicate Design — a dedicated, single-page
 * CAD-like editor (canvas + contextual property panels), mirroring AI
 * Designer's own Edit Design workspace exactly. Reached via "Open Design
 * Editor" on the main project page's own Edit Design step.
 */
export default async function ReplicateDesignEditWorkspacePage({ params }: PageProps) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_designer", "view").catch(() => notFound());

  const { id } = await params;

  let project;
  try {
    project = await getReplicateProjectById(session!.user.companyId, id);
  } catch (err) {
    if (err instanceof BusinessRuleError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  if (!project.currentVersion?.currentImage) notFound();

  return <EditReplicateDesignWorkspace key={id} projectId={id} initialProject={JSON.parse(JSON.stringify(project))} />;
}
