import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { StockBalancesListClient } from "./StockBalancesListClient";

export default async function StockBalancesPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view").catch(() => notFound());

  return <StockBalancesListClient />;
}
