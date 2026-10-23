import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { UploadBillForm } from "./UploadBillForm";

export default async function UploadBillPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "expenses", "create").catch(() => notFound());

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Expenses", href: "/accounts/expenses" },
          { label: "Upload Bill" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Upload Bill</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Upload the bill (photo or PDF) and its amount. You can add a voice note to explain it. It goes to the
          accountant as a pending expense — they choose the expense account, then it is approved and paid.
        </p>
      </div>
      <UploadBillForm />
    </div>
  );
}
