import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalesOrdersListClient } from "./SalesOrdersListClient";

export default async function SalesOrdersListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "sales_orders", "view").catch(() => notFound());

  return <SalesOrdersListClient />;
}
