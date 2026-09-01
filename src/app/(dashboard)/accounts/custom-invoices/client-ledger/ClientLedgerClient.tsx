"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface CustomerOption {
  id: string;
  name: string;
  code: string;
}

interface LedgerEntry {
  date: string;
  type: "INVOICE" | "PAYMENT" | "CREDIT_NOTE";
  reference: string;
  invoiceId: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface LedgerData {
  customer: { id: string; name: string; code: string };
  entries: LedgerEntry[];
  totalInvoiced: number;
  totalPaid: number;
  totalCredited: number;
  netOutstanding: number;
}

const TYPE_LABELS: Record<string, string> = {
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  CREDIT_NOTE: "Credit Note",
};

export function ClientLedgerClient() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Derived, not a separate state var — avoids a synchronous setState at the
  // top of the fetch effect (react-hooks/set-state-in-effect), matching the
  // pattern already established for this project's Reports pages.
  const isLoading = customerId !== "" && ledger === null && error === null;

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=500")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!customerId) return;
    fetch(`/api/v1/custom-invoices/client-ledger?customerId=${customerId}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load ledger.");
        setLedger(body.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load ledger."));
  }, [customerId]);

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Custom Invoices", href: "/accounts/custom-invoices" },
            { label: "Client Ledger" },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Custom Invoice — Client Ledger</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          A running statement of one client&apos;s Custom Invoices, payments, and credit notes.
        </p>
      </div>

      <div className="max-w-sm">
        <FormField label="Select Client" htmlFor="customerId">
          <select
            id="customerId"
            value={customerId}
            onChange={(e) => {
              setLedger(null);
              setError(null);
              setCustomerId(e.target.value);
            }}
            className={textInputClass()}
          >
            <option value="">Choose a client...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {isLoading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {ledger && (
        <>
          <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-3 text-sm sm:grid-cols-4 dark:border-zinc-800">
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Total Invoiced</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{ledger.totalInvoiced.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Total Paid</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{ledger.totalPaid.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Total Credited</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{ledger.totalCredited.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Net Outstanding</dt>
              <dd className="text-base font-semibold text-zinc-900 dark:text-zinc-50">₹{ledger.netOutstanding.toFixed(2)}</dd>
            </div>
          </dl>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Debit</th>
                  <th className="px-3 py-2 font-medium">Credit</th>
                  <th className="px-3 py-2 font-medium">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400">
                      No activity yet.
                    </td>
                  </tr>
                ) : (
                  ledger.entries.map((e, i) => (
                    <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="px-3 py-2">{e.date.slice(0, 10)}</td>
                      <td className="px-3 py-2">{TYPE_LABELS[e.type]}</td>
                      <td className="px-3 py-2">
                        <Link href={`/accounts/custom-invoices/${e.invoiceId}`} className="text-indigo-600 hover:text-indigo-500">
                          {e.reference}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{e.debit > 0 ? `₹${e.debit.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2">{e.credit > 0 ? `₹${e.credit.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2 font-medium">₹{e.runningBalance.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
