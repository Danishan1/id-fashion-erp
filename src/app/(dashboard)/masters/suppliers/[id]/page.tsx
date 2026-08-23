import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getSupplierById } from "@/modules/suppliers/supplier.service";
import { SupplierForm } from "../SupplierForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const supplier = await getSupplierById(session!.user.companyId, id).catch(() => null);
  if (!supplier) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Suppliers", href: "/masters/suppliers" },
            { label: supplier.name },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{supplier.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Code: {supplier.code}</p>
      </div>

      <SupplierForm
        key={id}
        submitUrl={`/api/v1/suppliers/${id}`}
        method="PATCH"
        redirectTo="/masters/suppliers"
        initialValues={{
          code: supplier.code,
          name: supplier.name,
          category: supplier.category,
          contactPerson: supplier.contactPerson ?? "",
          email: supplier.email ?? "",
          phone: supplier.phone ?? "",
          address: supplier.address ?? "",
          taxRegistrationNo: supplier.taxRegistrationNo ?? "",
          paymentTermsDays: supplier.paymentTermsDays?.toString() ?? "",
          defaultCurrencyCode: supplier.defaultCurrencyCode ?? "",
          isActive: supplier.isActive,
        }}
      />
    </div>
  );
}
