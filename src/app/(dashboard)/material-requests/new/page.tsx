import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { MaterialRequestForm } from "../MaterialRequestForm";

export default function NewMaterialRequestPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Material Requests", href: "/material-requests" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Material Request</h1>
      <MaterialRequestForm />
    </div>
  );
}
