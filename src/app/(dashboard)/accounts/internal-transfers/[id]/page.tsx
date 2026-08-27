import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getInternalTransferById } from "@/modules/accounts/internal-transfer.service";
import { InternalTransferWorkflowPanel } from "./InternalTransferWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function InternalTransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const transfer = await getInternalTransferById(session!.user.companyId, id).catch(() => null);
  if (!transfer) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Internal Transfers", href: "/accounts/internal-transfers" },
            { label: transfer.transferNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{transfer.transferNumber}</h1>
      </div>

      <InternalTransferWorkflowPanel key={id} transfer={JSON.parse(JSON.stringify(transfer))} />
    </div>
  );
}
