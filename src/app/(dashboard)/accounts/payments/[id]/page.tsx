import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getPaymentById } from "@/modules/accounts/payment.service";
import { PaymentWorkflowPanel } from "./PaymentWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const payment = await getPaymentById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!payment) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Payments", href: "/accounts/payments" },
            { label: payment.paymentNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{payment.paymentNumber}</h1>
      </div>

      <PaymentWorkflowPanel key={id} payment={JSON.parse(JSON.stringify(payment))} />
    </div>
  );
}
