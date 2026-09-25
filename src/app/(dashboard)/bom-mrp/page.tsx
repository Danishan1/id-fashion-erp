import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BomMrpListClient } from "./BomMrpListClient";

export default async function BomMrpListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "bom_mrp", "view").catch(() => notFound());

  const canViewDesignBom = await PermissionService.can(session!.user.id, "sampling", "view");
  const canApproveBom = await PermissionService.can(session!.user.id, "bom_mrp", "approve");

  return <BomMrpListClient canViewDesignBom={canViewDesignBom} canApproveBom={canApproveBom} />;
}
