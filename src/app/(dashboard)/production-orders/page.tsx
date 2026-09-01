import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ProductionOrdersListClient } from "./ProductionOrdersListClient";

export default async function ProductionOrdersListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "production", "view").catch(() => notFound());

  return <ProductionOrdersListClient />;
}
