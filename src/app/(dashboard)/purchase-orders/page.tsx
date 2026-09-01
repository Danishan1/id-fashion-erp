import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { PurchaseOrdersListClient } from "./PurchaseOrdersListClient";

export default async function PurchaseOrdersListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "purchasing", "view").catch(() => notFound());

  return <PurchaseOrdersListClient />;
}
