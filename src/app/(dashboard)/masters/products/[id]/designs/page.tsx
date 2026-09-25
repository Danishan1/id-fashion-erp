import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProductById } from "@/modules/products/product.service";
import { DesignsListClient } from "./DesignsListClient";

/**
 * A style's own "Designs" — every Sample Request ever built against it — as
 * a real page rather than the small popup modal this started as, per
 * explicit request: this is meant to grow into its own module (more than a
 * flat list), so it needs page-sized room rather than a modal's.
 */
export default async function StyleDesignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "sampling", "view").catch(() => notFound());
  // Gates the Images gallery's Upload/Set-as-Main/Remove controls (2026-09-24)
  // — same display-convenience-only discipline as the Sample Request detail
  // page's own equivalent.
  const canSamplingEdit = await PermissionService.can(session!.user.id, "sampling", "edit");

  const product = await getProductById(session!.user.companyId, id).catch(() => null);
  if (!product) notFound();

  return (
    <DesignsListClient
      productId={id}
      styleName={product.styleName}
      styleCode={product.styleCode}
      variantCount={product.variants.length}
      canSamplingEdit={canSamplingEdit}
    />
  );
}
