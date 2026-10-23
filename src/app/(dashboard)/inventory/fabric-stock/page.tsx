import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { FabricStockListClient } from "./FabricStockListClient";

export default async function FabricStockPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view").catch(() => notFound());

  return <FabricStockListClient />;
}
