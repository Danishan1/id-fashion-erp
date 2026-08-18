import { MaterialForm } from "../MaterialForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewMaterialPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Masters", href: "/masters" }, { label: "Raw Materials", href: "/masters/materials" }, { label: "New" }]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Material</h1>
      <MaterialForm submitUrl="/api/v1/materials" method="POST" redirectTo="/masters/materials" />
    </div>
  );
}
