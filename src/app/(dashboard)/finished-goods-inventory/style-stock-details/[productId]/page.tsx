import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getStyleStockSummary } from "@/modules/finished-goods-inventory/finished-goods-style-stock-details.service";
import { StyleStockDetailsClient } from "./StyleStockDetailsClient";

export default async function StyleStockDetailsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "fg_inventory", "view").catch(() => notFound());

  const summary = await getStyleStockSummary(session!.user.companyId, productId).catch(() => null);
  if (!summary) notFound();

  return <StyleStockDetailsClient productId={productId} summary={summary} />;
}
