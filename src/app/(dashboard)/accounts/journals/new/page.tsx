import { JournalForm } from "../JournalForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewJournalPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Accounts", href: "/accounts" }, { label: "Journals", href: "/accounts/journals" }, { label: "New" }]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Journal</h1>
      <JournalForm submitUrl="/api/v1/journals" method="POST" redirectBase="/accounts/journals" />
    </div>
  );
}
