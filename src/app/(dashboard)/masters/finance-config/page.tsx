import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { FinanceConfigClient } from "./FinanceConfigClient";

export default async function FinanceConfigPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_finance", "view").catch(() => notFound());

  return <FinanceConfigClient />;
}
