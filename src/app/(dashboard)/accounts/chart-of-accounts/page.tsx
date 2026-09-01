import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ChartOfAccountsListClient } from "./ChartOfAccountsListClient";

export default async function ChartOfAccountsListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "accounts", "view").catch(() => notFound());

  return <ChartOfAccountsListClient />;
}
