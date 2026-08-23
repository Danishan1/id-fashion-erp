import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { BuyerEnquiryForm } from "../BuyerEnquiryForm";

export default function NewBuyerEnquiryPage() {
  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Buyer Enquiries", href: "/buyer-enquiries" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Buyer Enquiry</h1>
      <BuyerEnquiryForm />
    </div>
  );
}
