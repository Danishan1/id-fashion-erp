import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ChangePasswordForm } from "./ChangePasswordForm";

// No PermissionService.assert here — self-scoped by construction, the same
// reasoning as the account.service.ts / change-password route: any
// authenticated, active user (already guaranteed by the (dashboard) layout's
// own auth gate) may view and use this page for their own account.
export default function MyAccountPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Account" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">My Account</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Change your own password.</p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
