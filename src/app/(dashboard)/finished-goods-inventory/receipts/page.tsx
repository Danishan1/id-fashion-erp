import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { FinishedGoodsReceiptsListClient } from "./FinishedGoodsReceiptsListClient";

export default async function FinishedGoodsReceiptsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "fg_inventory", "view").catch(() => notFound());

  return <FinishedGoodsReceiptsListClient />;
}
