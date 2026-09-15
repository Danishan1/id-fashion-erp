import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getSalesInvoiceById } from "@/modules/accounts/sales-invoice.service";
import { SalesInvoiceWorkflowPanel } from "./SalesInvoiceWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function SalesInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const invoice = await getSalesInvoiceById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!invoice) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
        <a
          href={`/api/v1/sales-invoices/${id}/pdf`}
          className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Download PDF
        </a>
      </div>

      <SalesInvoiceWorkflowPanel key={id} invoice={JSON.parse(JSON.stringify(invoice))} />
    </div>
  );
}
