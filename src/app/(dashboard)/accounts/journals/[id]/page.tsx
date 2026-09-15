import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getJournalById } from "@/modules/accounts/journal.service";
import { JournalWorkflowPanel } from "./JournalWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const journal = await getJournalById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!journal) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Journals", href: "/accounts/journals" },
            { label: journal.journalNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{journal.journalNumber}</h1>
      </div>

      <JournalWorkflowPanel key={id} journal={JSON.parse(JSON.stringify(journal))} />
    </div>
  );
}
