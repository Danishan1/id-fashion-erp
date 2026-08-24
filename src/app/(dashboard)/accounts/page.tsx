import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const ACCOUNTS_SECTIONS = [
  { href: "/accounts/chart-of-accounts", label: "Chart of Accounts", description: "Ledger account master (Asset/Liability/Equity/Income/Expense)" },
  { href: "/accounts/tax-config", label: "Tax Configuration", description: "Tax types and effective-dated tax rates" },
  { href: "/accounts/journals", label: "Journals", description: "Manual double-entry journal entries — create, post, reverse" },
  { href: "/accounts/sales-invoices", label: "Sales Invoices", description: "Invoices raised against confirmed sales orders, auto-posting to the ledger" },
  { href: "/accounts/purchase-invoices", label: "Purchase Invoices", description: "Supplier invoices raised against received purchase orders — partial and repeatable per order" },
  { href: "/accounts/payments", label: "Payments", description: "Money received from customers or paid to suppliers, allocated against invoices" },
  { href: "/accounts/ledger", label: "Account Ledger", description: "Posted transactions and running balance for one account" },
  { href: "/accounts/trial-balance", label: "Trial Balance", description: "Per-account debit/credit totals across all posted journals" },
];

export default function AccountsIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Accounts" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Accounts</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Chart of Accounts, tax configuration, the double-entry journal engine, Sales/Purchase Invoices, and
          Payments. Expenses is not part of this slice yet.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACCOUNTS_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="font-medium text-zinc-900 dark:text-zinc-50">{section.label}</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{section.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
