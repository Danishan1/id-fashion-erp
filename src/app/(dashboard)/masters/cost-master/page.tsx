import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CostMasterClient } from "./CostMasterClient";

export default async function CostMasterPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_finance", "view").catch(() => notFound());

  return <CostMasterClient />;
}
