import { DispatchForm } from "./DispatchForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewDispatchPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Dispatch", href: "/dispatch" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Dispatch</h1>
      <DispatchForm />
    </div>
  );
}
