import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getCustomerById } from "@/modules/customers/customer.service";
import { CustomerForm } from "../CustomerForm";
import { BuyersSection } from "../BuyersSection";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const customer = await getCustomerById(session!.user.companyId, id).catch(() => null);
  if (!customer) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Customers", href: "/masters/customers" },
            { label: customer.name },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{customer.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Code: {customer.code}</p>
      </div>

      <CustomerForm
        key={`form-${id}`}
        submitUrl={`/api/v1/customers/${id}`}
        method="PATCH"
        redirectTo="/masters/customers"
        initialValues={{
          code: customer.code,
          name: customer.name,
          type: customer.type as "CUSTOMER" | "AGENT",
          country: customer.country ?? "",
          paymentTermsDays: customer.paymentTermsDays?.toString() ?? "",
          creditLimit: customer.creditLimit?.toString() ?? "",
          defaultCurrencyCode: customer.defaultCurrencyCode ?? "",
          isActive: customer.isActive,
        }}
      />

      <BuyersSection key={`buyers-${id}`} customerId={id} initialBuyers={customer.buyers} />
    </div>
  );
}
