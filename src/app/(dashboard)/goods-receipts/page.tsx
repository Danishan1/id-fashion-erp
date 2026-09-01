import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { GoodsReceiptsListClient } from "./GoodsReceiptsListClient";

export default async function GoodsReceiptsListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view").catch(() => notFound());

  return <GoodsReceiptsListClient />;
}
