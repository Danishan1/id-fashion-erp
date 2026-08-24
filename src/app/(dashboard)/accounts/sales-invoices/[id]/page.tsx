import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getSalesInvoiceById } from "@/modules/accounts/sales-invoice.service";
import { SalesInvoiceWorkflowPanel } from "./SalesInvoiceWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function SalesInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const invoice = await getSalesInvoiceById(session!.user.companyId, id).catch(() => null);
  if (!invoice) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Sales Invoices", href: "/accounts/sales-invoices" },
            { label: invoice.invoiceNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{invoice.invoiceNumber}</h1>
      </div>

      <SalesInvoiceWorkflowPanel key={id} invoice={JSON.parse(JSON.stringify(invoice))} />
    </div>
  );
}
