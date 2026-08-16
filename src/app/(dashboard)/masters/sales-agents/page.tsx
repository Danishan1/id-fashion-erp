import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";

export default function SalesAgentsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Sales Agents</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Agents selling finished goods through the domestic/retail channel, distinct from export buyers.
        </p>
      </div>

      <SimpleLookupManager
        fetchUrl="/api/v1/sales-agents"
        fields={[
          { key: "code", label: "Code", required: true },
          { key: "name", label: "Name", required: true },
          { key: "contactPerson", label: "Contact Person" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "commissionPercent", label: "Commission %", type: "number" },
        ]}
      />
    </div>
  );
}
