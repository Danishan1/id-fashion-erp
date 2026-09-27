import { notFound, redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getProjectById } from "@/modules/ai-designer/ai-designer.service";
import { NewDesignWorkspace, type NewDesignProject } from "../NewDesignWorkspace";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NewDesignProjectPage({ params }: PageProps) {
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
  // A classic-wizard project has no New Design state — open it in its own wizard.
  if (!project.designSource) redirect(`/ai-designer/catalogue-designs/${id}`);

  return <NewDesignWorkspace key={id} initialProject={JSON.parse(JSON.stringify(project)) as NewDesignProject} />;
}
