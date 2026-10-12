import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const MASTER_SECTIONS = [
  { href: "/masters/customers", label: "Customers", description: "Customers and their buyers/brands" },
  { href: "/masters/suppliers", label: "Suppliers", description: "Fabric, trims, packaging, and service vendors" },
  { href: "/masters/contractors", label: "Contractors", description: "External job-work units, paid via Piece-Rate" },
  { href: "/masters/forwarders", label: "Forwarders", description: "Couriers / transporters used on Dispatch shipments" },
  { href: "/masters/employees", label: "Employees", description: "Staff records" },
  { href: "/masters/products", label: "Styles", description: "Product styles with color/size variants" },
  { href: "/masters/materials", label: "Raw Materials", description: "Fabric, trims, accessories, and packaging items" },
  { href: "/masters/lookups", label: "Colors, Sizes & Units", description: "Shared lookup values" },
  { href: "/masters/warehouses", label: "Warehouses", description: "Warehouses and storage locations" },
  {
    href: "/masters/production-config",
    label: "Production Stages, Lines & Machines",
    description: "Configurable production stages, factory lines, and machines",
  },
  { href: "/masters/sales-agents", label: "Sales Agents", description: "Domestic/retail sales channel agents" },
  {
    href: "/masters/garment-attributes",
    label: "Garment Attributes",
    description: "Brand, season, fitting, product type, design & pattern",
  },
  {
    href: "/masters/categories",
    label: "Categories",
    description: "Garment, Supplier, and Employee category masters, consolidated in one place",
  },
  {
    href: "/masters/fabric-config",
    label: "Fabric Configuration",
    description: "GSM, dye, weave type, width, and composition for fabric materials",
  },
  { href: "/masters/hr-config", label: "HR Configuration", description: "Departments, designations, shifts, and holidays" },
  { href: "/masters/cost-master", label: "Cost Master", description: "Overhead cost rates for costing" },
  { href: "/masters/finance-config", label: "Finance Configuration", description: "Payment types and bank accounts" },
  { href: "/masters/ai-design", label: "AI Design", description: "AI Designer's own configurable masters — Product Design attributes & options" },
];

export default function MastersIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Masters" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Masters</h1>
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
