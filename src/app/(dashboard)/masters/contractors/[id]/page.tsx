import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getContractorById } from "@/modules/contractors/contractor.service";
import { ContractorEditFormClient } from "./ContractorEditFormClient";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditContractorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const contractor = await getContractorById(session!.user.companyId, id).catch(() => null);
  if (!contractor) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Contractors", href: "/masters/contractors" },
            { label: contractor.name },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{contractor.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Code: {contractor.code}</p>
      </div>

      <ContractorEditFormClient
        key={`form-${id}`}
        id={id}
        initialValues={{
          code: contractor.code,
          name: contractor.name,
          contactPerson: contractor.contactPerson ?? "",
          phone: contractor.phone ?? "",
          email: contractor.email ?? "",
          address: contractor.address ?? "",
          isActive: contractor.isActive,
          stageIds: contractor.stages.map((s) => s.productionStageId),
        }}
      />
    </div>
  );
}
