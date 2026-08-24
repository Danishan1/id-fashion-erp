import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getPurchaseInvoiceById } from "@/modules/accounts/purchase-invoice.service";
import { PurchaseInvoiceWorkflowPanel } from "./PurchaseInvoiceWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function PurchaseInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const invoice = await getPurchaseInvoiceById(session!.user.companyId, id).catch(() => null);
  if (!invoice) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Purchase Invoices", href: "/accounts/purchase-invoices" },
            { label: invoice.invoiceNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{invoice.invoiceNumber}</h1>
      </div>

      <PurchaseInvoiceWorkflowPanel key={id} invoice={JSON.parse(JSON.stringify(invoice))} />
    </div>
  );
}
