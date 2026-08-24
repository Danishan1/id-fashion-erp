"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { textInputClass } from "@/components/ui/FormField";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface LedgerLine {
  id: string;
  journalNumber: string;
  journalDate: string;
  description: string | null;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
}

interface LedgerResult {
  account: { code: string; name: string; accountType: string };
  lines: LedgerLine[];
  closingBalance: number;
}

export default function LedgerPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [result, setResult] = useState<LedgerResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/v1/chart-of-accounts?pageSize=200")
      .then((res) => res.json())
      .then((body) => setAccounts(body.data ?? []));
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const timeout = setTimeout(() => {
      setIsLoading(true);
      const url = new URL(`/api/v1/chart-of-accounts/${accountId}/ledger`, window.location.origin);
      if (dateFrom) url.searchParams.set("dateFrom", dateFrom);
      if (dateTo) url.searchParams.set("dateTo", dateTo);
      fetch(url.toString())
        .then((res) => res.json())
        .then((body) => setResult(body.data))
        .finally(() => setIsLoading(false));
    }, 0);
    return () => clearTimeout(timeout);
  }, [accountId, dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Account Ledger" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Account Ledger</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Posted transactions and running balance for one account.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Account</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={textInputClass()}>
            <option value="">— Select account —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={textInputClass()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={textInputClass()} />
        </div>
      </div>

      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}

      {!isLoading && accountId && result && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Journal No.</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Debit</th>
                <th className="px-4 py-2 font-medium">Credit</th>
                <th className="px-4 py-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    No posted transactions in this range.
                  </td>
                </tr>
              )}
              {result.lines.map((line) => (
                <tr key={line.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-4 py-2">{line.journalNumber}</td>
                  <td className="px-4 py-2">{line.journalDate.slice(0, 10)}</td>
                  <td className="px-4 py-2">{line.description ?? "—"}</td>
                  <td className="px-4 py-2">{line.debitAmount > 0 ? line.debitAmount.toFixed(2) : ""}</td>
                  <td className="px-4 py-2">{line.creditAmount > 0 ? line.creditAmount.toFixed(2) : ""}</td>
                  <td className="px-4 py-2">{line.runningBalance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                <td colSpan={5} className="px-4 py-2">
                  Closing Balance
                </td>
                <td className="px-4 py-2">{result.closingBalance.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
