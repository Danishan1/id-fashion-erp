import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getProductById } from "@/modules/products/product.service";
import { ProductForm } from "../ProductForm";
import { VariantsSection } from "../VariantsSection";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const product = await getProductById(session!.user.companyId, id).catch(() => null);
  if (!product) notFound();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{product.styleName}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Style Code: {product.styleCode}</p>
      </div>

      <ProductForm
        submitUrl={`/api/v1/products/${id}`}
        method="PATCH"
        redirectTo="/masters/products"
        initialValues={{
          styleCode: product.styleCode,
          styleName: product.styleName,
          category: product.category ?? "",
          season: product.season ?? "",
          gender: product.gender ?? "",
          description: product.description ?? "",
          hsnSacCode: product.hsnSacCode ?? "",
          customerId: product.customerId ?? "",
          isActive: product.isActive,
        }}
      />

      <VariantsSection productId={id} initialVariants={product.variants} />
    </div>
  );
}
