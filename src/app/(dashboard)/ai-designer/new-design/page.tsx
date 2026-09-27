import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { NewDesignWorkspace } from "./NewDesignWorkspace";

export default async function NewDesignPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_designer", "create").catch(() => notFound());
  return <NewDesignWorkspace initialProject={null} />;
}
