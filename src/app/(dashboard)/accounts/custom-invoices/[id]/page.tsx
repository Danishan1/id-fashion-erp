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
      <div className="flex flex-wrap items-start justify-between gap-4">
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
        <div className="flex items-center gap-2">
          <a
            href={`/api/v1/custom-invoices/${id}/pdf?action=print`}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Print
          </a>
          <a
            href={`/api/v1/custom-invoices/${id}/pdf`}
            download
            className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Download PDF
          </a>
        </div>
      </div>

      <CustomInvoiceWorkflowPanel key={id} invoice={JSON.parse(JSON.stringify(invoice))} />
    </div>
  );
}
