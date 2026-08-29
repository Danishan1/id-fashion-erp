"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface Currency {
  code: string;
  name: string;
}

const EMPTY_VALUES = {
  companyName: "",
  legalName: "",
  taxRegistrationNo: "",
  baseCurrencyCode: "INR",
  fiscalYearStartMonth: "1",
  branchCode: "HO",
  branchName: "Head Office",
  branchType: "FACTORY" as "FACTORY" | "OFFICE" | "WAREHOUSE",
  adminEmail: "",
  adminPassword: "",
  adminFullName: "",
};

export default function NewPlatformCompanyPage() {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/currencies")
      .then((res) => res.json())
      .then((body) => setCurrencies(body.data ?? []))
      .catch(() => setCurrencies([]));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch("/api/v1/platform/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, fiscalYearStartMonth: Number(values.fiscalYearStartMonth) }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to create company.");
      return;
    }

    router.push("/platform/companies");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Companies", href: "/platform/companies" },
          { label: "New" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Company</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Creates a brand-new, fully independent tenant — its own data, its own users, nothing shared with any other
          company on this instance. This also creates the company&apos;s first branch and its first Super Admin login.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <fieldset className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Company</legend>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Company Name" htmlFor="companyName" required>
              <input
                id="companyName"
                required
                value={values.companyName}
                onChange={(e) => setValues({ ...values, companyName: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Legal Name" htmlFor="legalName">
              <input
                id="legalName"
                value={values.legalName}
                onChange={(e) => setValues({ ...values, legalName: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Tax Registration No." htmlFor="taxRegistrationNo">
              <input
                id="taxRegistrationNo"
                value={values.taxRegistrationNo}
                onChange={(e) => setValues({ ...values, taxRegistrationNo: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Base Currency" htmlFor="baseCurrencyCode" required>
              <select
                id="baseCurrencyCode"
                required
                value={values.baseCurrencyCode}
                onChange={(e) => setValues({ ...values, baseCurrencyCode: e.target.value })}
                className={textInputClass()}
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Fiscal Year Start Month" htmlFor="fiscalYearStartMonth" required>
              <select
                id="fiscalYearStartMonth"
                required
                value={values.fiscalYearStartMonth}
                onChange={(e) => setValues({ ...values, fiscalYearStartMonth: e.target.value })}
                className={textInputClass()}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">First Branch</legend>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Branch Code" htmlFor="branchCode" required>
              <input
                id="branchCode"
                required
                value={values.branchCode}
                onChange={(e) => setValues({ ...values, branchCode: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Branch Name" htmlFor="branchName" required>
              <input
                id="branchName"
                required
                value={values.branchName}
                onChange={(e) => setValues({ ...values, branchName: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Branch Type" htmlFor="branchType" required>
              <select
                id="branchType"
                required
                value={values.branchType}
                onChange={(e) => setValues({ ...values, branchType: e.target.value as typeof values.branchType })}
                className={textInputClass()}
              >
                <option value="FACTORY">Factory</option>
                <option value="OFFICE">Office</option>
                <option value="WAREHOUSE">Warehouse</option>
              </select>
            </FormField>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">First Super Admin Login</legend>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Full Name" htmlFor="adminFullName" required>
              <input
                id="adminFullName"
                required
                value={values.adminFullName}
                onChange={(e) => setValues({ ...values, adminFullName: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Email" htmlFor="adminEmail" required>
              <input
                id="adminEmail"
                type="email"
                required
                value={values.adminEmail}
                onChange={(e) => setValues({ ...values, adminEmail: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
          </div>
          <FormField label="Password" htmlFor="adminPassword" required>
            <input
              id="adminPassword"
              type="password"
              required
              minLength={8}
              value={values.adminPassword}
              onChange={(e) => setValues({ ...values, adminPassword: e.target.value })}
              className={textInputClass()}
            />
          </FormField>
        </fieldset>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? "Creating…" : "Create Company"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/platform/companies")}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
