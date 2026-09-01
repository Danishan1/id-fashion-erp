import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { EmployeeAdvancesListClient } from "./EmployeeAdvancesListClient";

export default async function EmployeeAdvancesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "expenses", "view").catch(() => notFound());

  return <EmployeeAdvancesListClient />;
}
