import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { LeadForm } from "../LeadForm";

export default function NewLeadPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads", href: "/leads" }, { label: "New" }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Lead</h1>
      <LeadForm />
    </div>
  );
}
