import { ProductForm } from "../ProductForm";

export default function NewProductPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Style</h1>
      <ProductForm submitUrl="/api/v1/products" method="POST" redirectTo="/masters/products" />
    </div>
  );
}
