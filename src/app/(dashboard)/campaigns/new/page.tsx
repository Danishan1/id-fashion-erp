import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { CampaignForm } from "../CampaignForm";

export default function NewCampaignPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Campaigns", href: "/campaigns" }, { label: "New" }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Campaign</h1>
      <CampaignForm />
    </div>
  );
}
