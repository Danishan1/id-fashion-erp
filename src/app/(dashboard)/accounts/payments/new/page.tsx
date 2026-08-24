import { PaymentForm } from "./PaymentForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewPaymentPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Payments", href: "/accounts/payments" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Payment</h1>
      <PaymentForm />
    </div>
  );
}
