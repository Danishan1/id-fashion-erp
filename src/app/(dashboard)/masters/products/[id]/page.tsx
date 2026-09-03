import { notFound, redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getProductById } from "@/modules/products/product.service";

/**
 * Style editing now happens via a modal on the Styles list — there is no
 * dedicated edit page anymore (see ProductsListClient.tsx). This route is
 * kept only because Sampling/Reports/etc. already deep-link straight to
 * /masters/products/{id} expecting to land on that style's edit view;
 * redirecting into the list with ?edit={id} preserves that contract without
 * requiring any change in the linking modules.
 */
export default async function ProductEditRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const product = await getProductById(session!.user.companyId, id).catch(() => null);
  if (!product) notFound();

  redirect(`/masters/products?edit=${id}`);
}
