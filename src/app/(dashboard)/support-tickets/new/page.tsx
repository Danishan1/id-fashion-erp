import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { NewTicketClient } from "./NewTicketClient";

export default async function NewSupportTicketPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.userType === "SUPPORT") notFound();
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Help & Support", href: "/support-tickets" },
          { label: "New ticket" },
        ]}
      />
      <NewTicketClient />
    </div>
  );
}
