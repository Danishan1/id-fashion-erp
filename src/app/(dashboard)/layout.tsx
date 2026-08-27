import type { ReactNode } from "react";
import { auth } from "@/core/auth/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  return (
    <div className="flex flex-1">
      <Sidebar isPlatformAdmin={session?.user?.isPlatformAdmin} />
      <div className="flex flex-1 flex-col">
        <Topbar userName={session?.user?.name ?? session?.user?.email ?? "User"} />
        <main className="flex-1 overflow-y-auto bg-zinc-50 p-6 dark:bg-zinc-950">{children}</main>
      </div>
    </div>
  );
}
