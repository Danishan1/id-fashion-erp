import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getBuyerEnquiryById } from "@/modules/buyer-enquiries/buyer-enquiry.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { BuyerEnquiryWorkflowPanel } from "../BuyerEnquiryWorkflowPanel";

export default async function BuyerEnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const enquiry = await getBuyerEnquiryById(session!.user.companyId, id).catch(() => null);
  if (!enquiry) notFound();

  const partyName = enquiry.customer?.name ?? enquiry.prospectName ?? "Unnamed prospect";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Buyer Enquiries", href: "/buyer-enquiries" },
              { label: enquiry.enquiryNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{enquiry.enquiryNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {partyName}
            {!enquiry.customer && <span className="text-amber-600 dark:text-amber-400"> (prospect)</span>}
            {enquiry.buyer ? ` — ${enquiry.buyer.name}` : ""} · Requested by {enquiry.requestedBy.fullName} on{" "}
            {new Date(enquiry.enquiryDate).toLocaleDateString()}
          </p>
        </div>
        <Barcode value={enquiry.enquiryNumber} />
      </div>

      {/* Decimal/Date fields aren't plain-serializable across the server/client
          boundary — round-trip through JSON, same pattern used by Sampling and
          Sales Orders. `key={id}` forces a remount on client-side navigation
          between two different enquiries (the stale-data class of bug fixed
          project-wide after the original Sampling incident). */}
      <BuyerEnquiryWorkflowPanel key={id} buyerEnquiryId={id} initialEnquiry={JSON.parse(JSON.stringify(enquiry))} />
    </div>
  );
}
