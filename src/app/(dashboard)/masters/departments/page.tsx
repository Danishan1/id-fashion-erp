import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";

export default function DepartmentsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Departments</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Used to organize employees (Cutting, Sewing, Finishing, Quality, Stores, Accounts, …).
        </p>
      </div>

      <SimpleLookupManager
        fetchUrl="/api/v1/departments"
        hasActiveToggle={false}
        fields={[
          { key: "code", label: "Code", required: true },
          { key: "name", label: "Name", required: true },
        ]}
      />
    </div>
  );
}
