import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { FinishedGoodsStockListClient } from "./FinishedGoodsStockListClient";

export default async function FinishedGoodsStockListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "fg_inventory", "view").catch(() => notFound());

  return <FinishedGoodsStockListClient />;
}
