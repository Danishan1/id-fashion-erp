import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getCustomInvoiceById } from "@/modules/accounts/custom-invoice.service";
import { CustomInvoiceWorkflowPanel } from "./CustomInvoiceWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function CustomInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const invoice = await getCustomInvoiceById(session!.user.companyId, id).catch(() => null);
  if (!invoice) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Custom Invoices", href: "/accounts/custom-invoices" },
            { label: invoice.invoiceNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{invoice.invoiceNumber}</h1>
      </div>

      <CustomInvoiceWorkflowPanel key={id} invoice={JSON.parse(JSON.stringify(invoice))} />
    </div>
  );
}
