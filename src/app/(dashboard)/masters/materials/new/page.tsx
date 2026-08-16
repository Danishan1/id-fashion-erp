import { MaterialForm } from "../MaterialForm";

export default function NewMaterialPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Material</h1>
      <MaterialForm submitUrl="/api/v1/materials" method="POST" redirectTo="/masters/materials" />
    </div>
  );
}
