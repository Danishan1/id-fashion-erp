import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { EmployeesListClient } from "./EmployeesListClient";

export default async function EmployeesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_core", "view").catch(() => notFound());

  return <EmployeesListClient />;
}
