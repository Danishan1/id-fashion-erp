import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getChartOfAccountById } from "@/modules/accounts/chart-of-account.service";
import { ChartOfAccountEditFormClient } from "./ChartOfAccountEditFormClient";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditChartOfAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const account = await getChartOfAccountById(session!.user.companyId, id).catch(() => null);
  if (!account) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Chart of Accounts", href: "/accounts/chart-of-accounts" },
            { label: account.name },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{account.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Code: {account.code}</p>
      </div>

      <ChartOfAccountEditFormClient
        key={id}
        id={id}
        initialValues={{
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          parentAccountId: account.parentAccountId ?? "",
        }}
      />
    </div>
  );
}
