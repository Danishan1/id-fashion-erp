import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getForwarderById } from "@/modules/forwarders/forwarder.service";
import { ForwarderEditFormClient } from "./ForwarderEditFormClient";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditForwarderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const forwarder = await getForwarderById(session!.user.companyId, id).catch(() => null);
  if (!forwarder) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Transporters", href: "/masters/transporters" },
            { label: forwarder.name },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{forwarder.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Code: {forwarder.code}</p>
      </div>

      <ForwarderEditFormClient
        key={`form-${id}`}
        id={id}
        initialValues={{
          code: forwarder.code,
          name: forwarder.name,
          type: forwarder.type,
          contactPerson: forwarder.contactPerson ?? "",
          phone: forwarder.phone ?? "",
          altPhone: forwarder.altPhone ?? "",
          email: forwarder.email ?? "",
          address: forwarder.address ?? "",
          city: forwarder.city ?? "",
          state: forwarder.state ?? "",
          country: forwarder.country ?? "",
          postalCode: forwarder.postalCode ?? "",
          gstin: forwarder.gstin ?? "",
          remarks: forwarder.remarks ?? "",
          isActive: forwarder.isActive,
        }}
      />
    </div>
  );
}
