"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface InvoiceItem {
  id: string;
  quantity: string;
  unitPrice: string;
  taxPercentage: string | null;
  taxAmount: string;
  lineTotal: string;
  product: { styleCode: string; styleName: string };
  taxRate: { name: string } | null;
}

interface PurchaseInvoiceDetail {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  status: "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID" | "CLOSED" | "CANCELLED";
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  purchaseOrder: { id: string; orderNumber: string };
  supplier: { name: string };
  journal: { id: string; journalNumber: string } | null;
  createdBy: { fullName: string };
  postedBy: { fullName: string } | null;
  items: InvoiceItem[];
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function PurchaseInvoiceWorkflowPanel({ invoice }: { invoice: PurchaseInvoiceDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const runAction = async (url: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Action failed.");
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[invoice.status] ?? ""}`}>
          {invoice.status}
        </span>
        {invoice.journal && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Journal:{" "}
            <Link href={`/accounts/journals/${invoice.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
              {invoice.journal.journalNumber}
            </Link>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Purchase Order</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            <Link href={`/purchase-orders/${invoice.purchaseOrder.id}`} className="text-indigo-600 hover:text-indigo-500">
              {invoice.purchaseOrder.orderNumber}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Supplier</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.supplier.name}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Supplier Ref.</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.supplierInvoiceNumber ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Invoice Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.invoiceDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Due Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.dueDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Created By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.createdBy.fullName}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Posted By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.postedBy?.fullName ?? "—"}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">Style</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Unit Price</th>
              <th className="px-3 py-2 font-medium">Tax</th>
              <th className="px-3 py-2 font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  {item.product.styleCode} — {item.product.styleName}
                </td>
                <td className="px-3 py-2">{Number(item.quantity)}</td>
                <td className="px-3 py-2">{Number(item.unitPrice).toFixed(2)}</td>
                <td className="px-3 py-2">
                  {item.taxRate ? `${item.taxRate.name} (${Number(item.taxAmount).toFixed(2)})` : "—"}
                </td>
                <td className="px-3 py-2">{Number(item.lineTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
              <td className="px-3 py-2" colSpan={3}>
                Subtotal {Number(invoice.subtotalAmount).toFixed(2)} + Tax {Number(invoice.taxAmount).toFixed(2)}
              </td>
              <td className="px-3 py-2" colSpan={2}>
                Total {Number(invoice.totalAmount).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {invoice.status === "DRAFT" && (
        <div className="flex gap-3">
          <button
            onClick={() => setShowPostConfirm(true)}
            disabled={isBusy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Post
          </button>
          <button
            onClick={() => setShowCancelConfirm(true)}
            disabled={isBusy}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400"
          >
            Cancel
          </button>
        </div>
      )}

      <ConfirmModal
        open={showPostConfirm}
        title="Post invoice?"
        message={`Posting will lock this invoice permanently and auto-create a settlement Journal (Dr Purchases/COGS / Dr GST Input Tax Credit${Number(invoice.taxAmount) > 0 ? "" : " (none)"} / Cr Accounts Payable) for ${Number(invoice.totalAmount).toFixed(2)}. This does not change the purchase order's status.`}
        confirmLabel="Post"
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/purchase-invoices/${invoice.id}/post`);
          if (ok) setShowPostConfirm(false);
        }}
        onCancel={() => setShowPostConfirm(false)}
      />

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel invoice?"
        message="This draft invoice will be cancelled."
        confirmLabel="Cancel Invoice"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/purchase-invoices/${invoice.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </div>
  );
}
