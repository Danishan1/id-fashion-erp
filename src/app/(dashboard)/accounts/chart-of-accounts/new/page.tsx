import { ChartOfAccountForm } from "../ChartOfAccountForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewChartOfAccountPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Chart of Accounts", href: "/accounts/chart-of-accounts" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Account</h1>
      <ChartOfAccountForm submitUrl="/api/v1/chart-of-accounts" method="POST" redirectTo="/accounts/chart-of-accounts" />
    </div>
  );
}
