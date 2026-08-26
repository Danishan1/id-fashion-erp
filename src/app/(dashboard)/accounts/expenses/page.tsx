import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ExpensesListClient } from "./ExpensesListClient";

export default async function ExpensesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "expenses", "view").catch(() => notFound());

  return <ExpensesListClient />;
}
