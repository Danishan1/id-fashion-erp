import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ProductsListClient } from "./ProductsListClient";

export default async function ProductsListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_core", "view").catch(() => notFound());
  // Stage-cost editing is gated on the same masters_core.edit the API enforces.
  const canEditStageCosts = await PermissionService.can(session!.user.id, "masters_core", "edit");

  return <ProductsListClient canEditStageCosts={canEditStageCosts} />;
}
