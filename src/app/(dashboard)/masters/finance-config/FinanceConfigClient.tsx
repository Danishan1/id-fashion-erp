"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FINANCIAL_ACCOUNT_KINDS, FINANCIAL_ACCOUNT_KIND_LABELS } from "@/modules/finance-config/finance-config.schema";

const TABS = ["Payment Types", "Bank Accounts", "Invoice Series"] as const;
type Tab = (typeof TABS)[number];

export function FinanceConfigClient() {
  const [tab, setTab] = useState<Tab>("Payment Types");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Finance Configuration" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Finance Configuration</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Payment types, and bank / financial accounts (banks, cash boxes, FD, RD, credit cards, loans given,
          investments). Every financial account gets its own ledger account in the Chart of Accounts, so its balance
          shows in the Account Ledger and Trial Balance.
        </p>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Payment Types" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/payment-types"
          entityLabel="Payment Type"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            {
              key: "type",
              label: "Type",
              type: "select",
              required: true,
              options: [
                { value: "CASH", label: "Cash" },
                { value: "BANK", label: "Bank" },
                { value: "CHEQUE", label: "Cheque" },
                { value: "CARD", label: "Card" },
                { value: "UPI", label: "UPI" },
                { value: "OTHER", label: "Other" },
              ],
            },
          ]}
        />
      )}
      {tab === "Bank Accounts" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/bank-accounts"
          entityLabel="Bank / Financial Account"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Label", required: true, placeholder: "e.g. Primary Current A/C" },
            {
              key: "accountKind",
              label: "Kind (can't change later)",
              type: "select",
              required: true,
              options: FINANCIAL_ACCOUNT_KINDS.map((k) => ({ value: k, label: FINANCIAL_ACCOUNT_KIND_LABELS[k] })),
            },
            { key: "bankName", label: "Bank Name (bank / FD / RD / card)" },
            { key: "accountNumber", label: "Account / Card No." },
            { key: "ifscCode", label: "IFSC" },
            { key: "branch", label: "Branch" },
            { key: "accountHolderName", label: "Account Holder" },
            { key: "upiId", label: "UPI ID" },
            { key: "maturityDate", label: "Maturity Date (FD / RD)", type: "date" },
            { key: "interestRate", label: "Interest Rate %", type: "number" },
            { key: "creditLimit", label: "Credit Limit (card)", type: "number" },
          ]}
          displayColumns={[
            { key: "code", header: "Code" },
            { key: "name", header: "Label" },
            { key: "accountKind", header: "Kind" },
            { key: "bankName", header: "Bank" },
            { key: "accountNumber", header: "Account No." },
          ]}
        />
      )}
      {tab === "Invoice Series" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/invoice-series"
          entityLabel="Invoice Series"
          fields={[
            { key: "name", label: "Series Name", required: true, placeholder: "e.g. Retail Series" },
            { key: "prefix", label: "Prefix", required: true, placeholder: "e.g. RET" },
            { key: "fiscalYearLabel", label: "Fiscal Year Label", required: true, placeholder: "e.g. 2025-2026" },
          ]}
          displayColumns={[
            { key: "name", header: "Series Name" },
            { key: "prefix", header: "Prefix" },
            { key: "fiscalYearLabel", header: "Fiscal Year" },
            { key: "nextNumber", header: "Next No." },
          ]}
        />
      )}
    </div>
  );
}
