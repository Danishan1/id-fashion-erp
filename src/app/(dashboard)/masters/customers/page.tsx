import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CustomersListClient } from "./CustomersListClient";

export default async function CustomersListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_core", "view").catch(() => notFound());

  return <CustomersListClient />;
}
