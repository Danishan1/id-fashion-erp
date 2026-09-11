import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AiDesignMastersClient } from "./AiDesignMastersClient";

export default async function AiDesignMastersPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_designer", "view").catch(() => notFound());

  return <AiDesignMastersClient />;
}
