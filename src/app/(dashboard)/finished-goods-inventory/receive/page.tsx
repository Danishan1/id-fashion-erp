import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ReceiveFinishedGoodsClient } from "./ReceiveFinishedGoodsClient";

export default async function ReceiveFinishedGoodsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "fg_inventory", "view").catch(() => notFound());
  const canEdit = await PermissionService.can(session!.user.id, "fg_inventory", "edit");

  return <ReceiveFinishedGoodsClient canEdit={canEdit} />;
}
