import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SuppliersListClient } from "./SuppliersListClient";

export default async function SuppliersListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_core", "view").catch(() => notFound());

  return <SuppliersListClient />;
}
