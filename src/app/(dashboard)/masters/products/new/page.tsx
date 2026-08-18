import { ProductForm } from "../ProductForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewProductPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Masters", href: "/masters" }, { label: "Styles", href: "/masters/products" }, { label: "New" }]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Style</h1>
      <ProductForm submitUrl="/api/v1/products" method="POST" redirectTo="/masters/products" />
    </div>
  );
}
