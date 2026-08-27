import { InternalTransferForm } from "./InternalTransferForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewInternalTransferPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Internal Transfers", href: "/accounts/internal-transfers" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Internal Transfer</h1>
      <InternalTransferForm />
    </div>
  );
}
