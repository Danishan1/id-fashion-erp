"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_SECTIONS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Masters", href: "/masters" },
  { label: "CRM", href: "/crm" },
  { label: "Leads", href: "/leads" },
  { label: "Deals", href: "/deals" },
  { label: "Follow-ups", href: "/follow-ups" },
  { label: "Marketing", href: "/marketing" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Import History", href: "/imports" },
  { label: "Attendance", href: "/attendance" },
  { label: "Leave Requests", href: "/leave-requests" },
  { label: "Leave Types", href: "/leave-types" },
  { label: "Buyer Enquiries", href: "/buyer-enquiries" },
  { label: "Sampling", href: "/sampling" },
  { label: "Sales Orders", href: "/sales-orders" },
  { label: "Purchase Orders", href: "/purchase-orders" },
  { label: "Goods Receipts", href: "/goods-receipts" },
  { label: "BOM / MRP", href: "/bom-mrp" },
  { label: "Production", href: "/production-orders" },
  { label: "Job Work Orders", href: "/production/job-work" },
  { label: "Inventory", href: "/inventory/stock-balances" },
  { label: "Stock Movements", href: "/inventory/stock-movements" },
  { label: "Material Requests", href: "/material-requests" },
  { label: "Accounts", href: "/accounts" },
  { label: "Dispatch", href: "/dispatch" },
  { label: "Reports", href: "/reports" },
  { label: "Administration", href: "/admin" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-60 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-14 items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Fashion ERP</span>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {NAV_SECTIONS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm ${
                isActive
                  ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
