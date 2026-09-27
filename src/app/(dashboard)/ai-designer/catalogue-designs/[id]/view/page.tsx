import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getProjectById } from "@/modules/ai-designer/ai-designer.service";
import { DesignViewClient, type DesignViewProject } from "./DesignViewClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DesignViewPage({ params }: PageProps) {
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

  return <DesignViewClient key={id} project={JSON.parse(JSON.stringify(project)) as DesignViewProject} />;
}
