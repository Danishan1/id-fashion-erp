import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DealForm } from "../DealForm";

export default function NewDealPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Deals", href: "/deals" }, { label: "New" }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Deal</h1>
      <DealForm />
    </div>
  );
}
