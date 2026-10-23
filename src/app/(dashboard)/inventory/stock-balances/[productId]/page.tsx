import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { StockBalanceDetailClient } from "./StockBalanceDetailClient";

export default async function StockBalanceDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view").catch(() => notFound());
  const { productId } = await params;

  return <StockBalanceDetailClient key={productId} productId={productId} />;
}
