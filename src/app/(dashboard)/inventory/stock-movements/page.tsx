import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { StockMovementsListClient } from "./StockMovementsListClient";

export default async function StockMovementsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view").catch(() => notFound());

  return <StockMovementsListClient />;
}
