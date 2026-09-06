import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { AiGarmentProjectForm } from "../AiGarmentProjectForm";

export default async function NewAiGarmentProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  const sourceType = source === "FABRIC" ? "FABRIC" : "REFERENCE";

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "AI Garment Flow", href: "/ai-garment-flow" },
          { label: "New Project" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        New Project — {sourceType === "FABRIC" ? "Start From Fabric" : "Start From Reference"}
      </h1>
      <AiGarmentProjectForm sourceType={sourceType} />
    </div>
  );
}
