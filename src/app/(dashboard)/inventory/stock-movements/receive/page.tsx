import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ReceiveStockListClient } from "./ReceiveStockListClient";

export default async function ReceiveStockPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view").catch(() => notFound());

  return <ReceiveStockListClient />;
}
