import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getProductById } from "@/modules/products/product.service";
import { ProductForm } from "../ProductForm";
import { VariantsSection } from "../VariantsSection";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const product = await getProductById(session!.user.companyId, id).catch(() => null);
  if (!product) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Styles", href: "/masters/products" },
            { label: product.styleName },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{product.styleName}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Style Code: {product.styleCode}</p>
      </div>

      <ProductForm
        key={`form-${id}`}
        submitUrl={`/api/v1/products/${id}`}
        method="PATCH"
        redirectTo="/masters/products"
        initialValues={{
          styleCode: product.styleCode,
          styleName: product.styleName,
          designNumber: product.designNumber ?? "",
          categoryId: product.categoryId ?? "",
          seasonId: product.seasonId ?? "",
          brandId: product.brandId ?? "",
          productTypeId: product.productTypeId ?? "",
          productFittingId: product.productFittingId ?? "",
          gender: product.gender ?? "",
          description: product.description ?? "",
          hsnSacCode: product.hsnSacCode ?? "",
          customerId: product.customerId ?? "",
          isActive: product.isActive,
        }}
      />

      <VariantsSection key={`variants-${id}`} productId={id} initialVariants={product.variants} />
    </div>
  );
}
