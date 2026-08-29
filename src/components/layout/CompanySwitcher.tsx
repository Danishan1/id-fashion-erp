"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

interface CompanyOption {
  id: string;
  name: string;
  isActive: boolean;
}

// Renders nothing for an ordinary user — company switching is a
// platform-admin-only capability (see PermissionService.can()'s own
// isPlatformAdmin bypass, which is what makes switching here actually grant
// real access to the selected company, not just relabel the sidebar).
export function CompanySwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [switching, setSwitching] = useState(false);

  const isPlatformAdmin = session?.user?.isPlatformAdmin ?? false;
  const activeCompanyId = session?.user?.companyId;
  const homeCompanyId = session?.user?.homeCompanyId;

  useEffect(() => {
    if (!isPlatformAdmin) return;
    fetch("/api/v1/platform/companies")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body) => setCompanies(body.data ?? []))
      .catch(() => setCompanies([]));
  }, [isPlatformAdmin]);

  if (!isPlatformAdmin) return null;

  async function switchTo(companyId: string) {
    if (!companyId || companyId === activeCompanyId || switching) return;
    setSwitching(true);
    await update({ companyId });
    setSwitching(false);
    // Server Components (every dashboard page) read the company via
    // auth() server-side — a client-only session update doesn't re-render
    // them on its own, so a real refresh is required for the switch to
    // actually take effect on screen.
    router.refresh();
  }

  return (
    <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <label
        htmlFor="company-switcher"
        className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        Active Company
      </label>
      <select
        id="company-switcher"
        value={activeCompanyId ?? ""}
        disabled={switching || companies.length === 0}
        onChange={(e) => switchTo(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
      >
        {companies.length === 0 && <option value={activeCompanyId ?? ""}>Loading…</option>}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {!c.isActive ? " (Inactive)" : ""}
          </option>
        ))}
      </select>
      {homeCompanyId && activeCompanyId !== homeCompanyId && (
        <button
          type="button"
          onClick={() => switchTo(homeCompanyId)}
          disabled={switching}
          className="mt-1 text-xs text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
        >
          ← Back to my own company
        </button>
      )}
    </div>
  );
}
