"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
}

interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  grandTotalDebit: number;
  grandTotalCredit: number;
}

export default function TrialBalancePage() {
  const [result, setResult] = useState<TrialBalanceResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/trial-balance")
      .then((res) => res.json())
      .then((body) => setResult(body.data))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Trial Balance" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Trial Balance</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Per-account debit/credit totals across every posted journal.</p>
      </div>

      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}

      {!isLoading && result && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Debit</th>
                <th className="px-4 py-2 font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {result.rows
                .filter((r) => r.totalDebit > 0 || r.totalCredit > 0)
                .map((row) => (
                  <tr key={row.accountId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2">{row.code}</td>
                    <td className="px-4 py-2">{row.name}</td>
                    <td className="px-4 py-2">{row.accountType}</td>
                    <td className="px-4 py-2">{row.totalDebit > 0 ? row.totalDebit.toFixed(2) : ""}</td>
                    <td className="px-4 py-2">{row.totalCredit > 0 ? row.totalCredit.toFixed(2) : ""}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                <td className="px-4 py-2" colSpan={3}>
                  Grand Total
                </td>
                <td className="px-4 py-2">{result.grandTotalDebit.toFixed(2)}</td>
                <td className="px-4 py-2">{result.grandTotalCredit.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
