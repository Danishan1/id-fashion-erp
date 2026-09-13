import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getReplicateProjectById } from "@/modules/ai-designer/replicate-design.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { ReplicateDesignWorkspace } from "./ReplicateDesignWorkspace";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReplicateDesignDetailPage({ params }: PageProps) {
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

  return <ReplicateDesignWorkspace key={id} projectId={id} initialProject={JSON.parse(JSON.stringify(project))} />;
}
