import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getCustomInvoiceById } from "@/modules/accounts/custom-invoice.service";
import { CustomInvoiceForm } from "../../new/CustomInvoiceForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditCustomInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const invoice = await getCustomInvoiceById(session!.user.companyId, id).catch(() => null);
  // Mirrors updateCustomInvoice()'s own real guard exactly (status DRAFT,
  // zero paid/credited so far, and — deliberately — no credit note history
  // at all, even a cancelled one; see that function's own comment).
  const hasActivity = !!invoice && (Number(invoice.paidAmount) > 0 || Number(invoice.creditedAmount) > 0 || invoice.creditNotes.length > 0);
  if (!invoice || invoice.status !== "DRAFT" || hasActivity) notFound();

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Custom Invoices", href: "/accounts/custom-invoices" },
          { label: invoice.invoiceNumber, href: `/accounts/custom-invoices/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit Invoice — {invoice.invoiceNumber}</h1>
      <CustomInvoiceForm key={id} initialInvoice={JSON.parse(JSON.stringify(invoice))} />
    </div>
  );
}
