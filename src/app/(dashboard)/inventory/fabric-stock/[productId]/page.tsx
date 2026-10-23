import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { FabricStockDetailClient } from "./FabricStockDetailClient";

export default async function FabricStockDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view").catch(() => notFound());
  const { productId } = await params;

  return <FabricStockDetailClient key={productId} productId={productId} />;
}
