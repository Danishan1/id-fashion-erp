"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { formatDate } from "@/lib/date-format";
import { SUBSCRIPTION_STATE_LABELS, type SubscriptionAccessState } from "@/core/subscriptions/subscription-state";

export interface CompanySummaryItem {
  id: string;
  name: string;
  legalName: string | null;
  taxRegistrationNo: string | null;
  baseCurrencyCode: string;
  isActive: boolean;
  createdAt: string | Date;
  activeUsers: number;
  lastLoginAt: string | Date | null;
  disabledModuleCount: number;
  planName: string | null;
  subscriptionState: SubscriptionAccessState;
  periodEndsAt: string | Date | null;
}

interface PlatformCompaniesClientProps {
  companies: CompanySummaryItem[];
  canCreate: boolean;
  canRequestSupport: boolean;
}

type SortField = "name" | "createdAt" | "activeUsers" | "lastLoginAt";
type SortDirection = "asc" | "desc";

export function PlatformCompaniesClient({ companies, canCreate, canRequestSupport }: PlatformCompaniesClientProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [subFilter, setSubFilter] = useState<string>("ALL");
  const [planFilter, setPlanFilter] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  // Summary Metrics
  const stats = useMemo(() => {
    const total = companies.length;
    const active = companies.filter((c) => c.isActive).length;
    const suspended = total - active;
    const inTrial = companies.filter((c) => c.subscriptionState === "TRIAL").length;
    const paying = companies.filter((c) => c.subscriptionState === "ACTIVE").length;
    const totalUsers = companies.reduce((acc, c) => acc + c.activeUsers, 0);

    return { total, active, suspended, inTrial, paying, totalUsers };
  }, [companies]);

  // Unique plans for dropdown
  const uniquePlans = useMemo(() => {
    const plans = new Set<string>();
    for (const c of companies) {
      if (c.planName) plans.add(c.planName);
    }
    return Array.from(plans).sort();
  }, [companies]);

  // Filtered & Sorted items
  const filteredCompanies = useMemo(() => {
    return companies
      .filter((c) => {
        // Search query
        if (search.trim()) {
          const q = search.toLowerCase().trim();
          const nameMatch = c.name.toLowerCase().includes(q);
          const legalMatch = c.legalName ? c.legalName.toLowerCase().includes(q) : false;
          const taxMatch = c.taxRegistrationNo ? c.taxRegistrationNo.toLowerCase().includes(q) : false;
          if (!nameMatch && !legalMatch && !taxMatch) return false;
        }

        // Status Filter
        if (statusFilter === "ACTIVE" && !c.isActive) return false;
        if (statusFilter === "SUSPENDED" && c.isActive) return false;

        // Subscription State Filter
        if (subFilter !== "ALL" && c.subscriptionState !== subFilter) return false;

        // Plan Filter
        if (planFilter !== "ALL") {
          if (planFilter === "__NONE__" && c.planName) return false;
          if (planFilter !== "__NONE__" && c.planName !== planFilter) return false;
        }

        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === "name") {
          cmp = a.name.localeCompare(b.name);
        } else if (sortField === "createdAt") {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          cmp = aTime - bTime;
        } else if (sortField === "activeUsers") {
          cmp = a.activeUsers - b.activeUsers;
        } else if (sortField === "lastLoginAt") {
          const aTime = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
          const bTime = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
          cmp = aTime - bTime;
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [companies, search, statusFilter, subFilter, planFilter, sortField, sortDir]);

  const hasActiveFilters = search || statusFilter !== "ALL" || subFilter !== "ALL" || planFilter !== "ALL";

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setSubFilter("ALL");
    setPlanFilter("ALL");
  };

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Companies" }]} />

      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Companies & Tenants</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage hosted garment and textile manufacturers, monitor subscriptions, module access, and tenant status.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/platform/companies/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <span>+ New Company</span>
          </Link>
        )}
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Companies</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{stats.total}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Active Tenants</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{stats.active}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-red-600 dark:text-red-400">Suspended</div>
          <div className="mt-1 text-2xl font-semibold text-red-600 dark:text-red-400">{stats.suspended}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400">In Trial</div>
          <div className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-400">{stats.inTrial}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Total Active Users</div>
          <div className="mt-1 text-2xl font-semibold text-indigo-600 dark:text-indigo-400">{stats.totalUsers}</div>
        </div>
      </div>

      {/* Filters & Search Control Bar */}
      <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
          {/* Search box */}
          <div className="lg:col-span-2">
            <label htmlFor="company-search" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Search by name or tax ID
            </label>
            <div className="relative mt-1">
              <input
                id="company-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, legal name, GST/Tax..."
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-xs text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Status Filter */}
          <div>
            <label htmlFor="company-status-filter" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Company Status
            </label>
            <select
              id="company-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "SUSPENDED")}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="SUSPENDED">Suspended Only</option>
            </select>
          </div>

          {/* Subscription State Filter */}
          <div>
            <label htmlFor="company-subscription-filter" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Subscription
            </label>
            <select
              id="company-subscription-filter"
              value={subFilter}
              onChange={(e) => setSubFilter(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="ALL">All Subscriptions</option>
              <option value="TRIAL">Trial</option>
              <option value="ACTIVE">Active (Paid)</option>
              <option value="UNLIMITED">No Expiry (Complimentary)</option>
              <option value="GRACE">In Grace Period</option>
              <option value="EXPIRED">Expired</option>
              <option value="NONE">No Subscription</option>
            </select>
          </div>

          {/* Plan Filter */}
          <div>
            <label htmlFor="company-plan-filter" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Plan
            </label>
            <select
              id="company-plan-filter"
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="ALL">All Plans</option>
              {uniquePlans.map((plan) => (
                <option key={plan} value={plan}>
                  {plan}
                </option>
              ))}
              <option value="__NONE__">No Plan Assigned</option>
            </select>
          </div>
        </div>

        {/* Results Info & Sort Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div>
            Showing <span className="font-semibold text-zinc-900 dark:text-zinc-100">{filteredCompanies.length}</span> of{" "}
            {companies.length} companies
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-2 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Clear all filters
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span>Sort by:</span>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              <option value="createdAt">Date Created</option>
              <option value="name">Company Name</option>
              <option value="activeUsers">Active Users</option>
              <option value="lastLoginAt">Recent Login</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              title="Toggle sort direction"
            >
              {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
            </button>
          </div>
        </div>
      </div>

      {/* Companies Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Company Name</th>
              <th className="px-4 py-3 font-medium">Tax Reg. No.</th>
              <th className="px-4 py-3 font-medium">Active Users</th>
              <th className="px-4 py-3 font-medium">Last Login</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Subscription</th>
              <th className="px-4 py-3 font-medium">Modules Off</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredCompanies.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-zinc-500">
                  <div className="mx-auto max-w-sm space-y-2">
                    <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">No companies found</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {hasActiveFilters
                        ? "Try clearing your search terms or filters to find what you're looking for."
                        : "No companies have been provisioned yet on this platform."}
                    </p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-2 inline-flex items-center rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredCompanies.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <Link href={`/platform/companies/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {c.name}
                    </Link>
                    {c.legalName && <div className="text-xs text-zinc-500 dark:text-zinc-400">{c.legalName}</div>}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300 font-mono text-xs">{c.taxRegistrationNo ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300 font-medium">{c.activeUsers}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300 text-xs">
                    {c.lastLoginAt ? formatDate(c.lastLoginAt) : <span className="text-zinc-400">Never</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {c.planName ? (
                      <span className="inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                        {c.planName}
                      </span>
                    ) : (
                      <span className="text-zinc-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    <div className="text-xs font-medium">{SUBSCRIPTION_STATE_LABELS[c.subscriptionState]}</div>
                    {c.periodEndsAt && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">until {formatDate(c.periodEndsAt)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300 text-xs">
                    {c.disabledModuleCount > 0 ? (
                      <span className="inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                        {c.disabledModuleCount} off
                      </span>
                    ) : (
                      <span className="text-zinc-400">All on</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        c.isActive
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300"
                      }`}
                    >
                      {c.isActive ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">{formatDate(c.createdAt)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-xs">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/platform/companies/${c.id}`}
                        className="rounded border border-zinc-200 px-2 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Manage
                      </Link>
                      {canRequestSupport && c.isActive && (
                        <Link
                          href={`/platform/support?companyId=${c.id}`}
                          className="rounded bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900"
                        >
                          Support Access
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
