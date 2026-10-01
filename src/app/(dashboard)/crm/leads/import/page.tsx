import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ImportWizard } from "../imports/_components/ImportWizard";

/** CSV / XLSX lead import wizard (crm.create). `?job=<id>` resumes an import. */
export default async function ImportLeadsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  const { job } = await searchParams;
  const jobId = job && /^[0-9a-f-]{36}$/i.test(job) ? job : null;
  return (
    <>
      <CrmPageHeader
        title="Import leads"
        description="Upload a CSV or Excel file, match its columns, preview every row and choose how duplicates are handled before anything is imported."
        breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: "Import" }]}
      />
      <ImportWizard key={jobId ?? "new"} initialJobId={jobId} />
    </>
  );
}
