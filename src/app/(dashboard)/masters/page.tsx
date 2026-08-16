import Link from "next/link";

const MASTER_SECTIONS = [
  { href: "/masters/customers", label: "Customers", description: "Customers and their buyers/brands" },
  { href: "/masters/suppliers", label: "Suppliers", description: "Fabric, trims, packaging, and service vendors" },
  { href: "/masters/employees", label: "Employees", description: "Staff records and departments" },
  { href: "/masters/products", label: "Styles", description: "Product styles with color/size variants" },
  { href: "/masters/lookups", label: "Colors, Sizes & Units", description: "Shared lookup values" },
  { href: "/masters/warehouses", label: "Warehouses", description: "Warehouses and storage locations" },
];

export default function MastersIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Masters</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Centralized master data used across every module.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MASTER_SECTIONS.map((section) => (
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
