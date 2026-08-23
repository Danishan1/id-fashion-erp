import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SampleRequestForm } from "../SampleRequestForm";

export default function NewSampleRequestPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sampling", href: "/sampling" }, { label: "New" }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Sample Request</h1>
      <SampleRequestForm />
    </div>
  );
}
