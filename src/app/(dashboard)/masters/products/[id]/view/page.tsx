import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProductById } from "@/modules/products/product.service";
import { StyleViewClient } from "./StyleViewClient";

/**
 * A read-only, ecommerce-style product page for one Style — big main image,
 * every other uploaded image as a smaller clickable thumbnail row, and a
 * Sampling Cost summary pulled from its own approved designs. Deliberately
 * separate from the Edit modal/Designs list/Images modal — this is a single
 * page meant to be shared/glanced at, not an editing surface.
 */
export default async function StyleViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_core", "view").catch(() => notFound());

  const product = await getProductById(session!.user.companyId, id).catch(() => null);
  if (!product) notFound();

  return <StyleViewClient productId={id} initialProduct={JSON.parse(JSON.stringify(product))} />;
}
